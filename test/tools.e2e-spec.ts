import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { AiAgentEntity } from '../src/database/entities';
import { DEFAULT_SYSTEM_PROMPT } from '../src/ai/prompts/prompt.service';
import { ToolsAdminService } from '../src/tools/tools-admin.service';
import { MessageSenderType, ToolExecutionStatus, UserRole } from '../src/common/constants';

/**
 * Phase 6 acceptance (master plan §47, §26):
 *   the AI retrieves real-time business data through tools and never
 *   fabricates it.
 *
 * Runs the whole path — model requests a tool, the service checks the
 * allowlist, validates input, executes against Postgres, logs the call, and
 * the result comes back as the customer's answer.
 */
describe('AI tools (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let dataSource: DataSource;

  const password = 'Password123!';
  let orgSlug: string;
  let organizationId: string;
  let adminToken: string;
  let agentUserToken: string;
  let agentId: string;
  let toolIds: Record<string, string> = {};
  let customerId: string;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function startChat(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ organizationSlug: orgSlug, name: 'Tool Customer' })
      .expect(201);
    return response.body.data.sessionToken;
  }

  async function ask(token: string, content: string): Promise<string> {
    await request(app.getHttpServer())
      .post('/api/v1/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content })
      .expect(201);

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const messages = await request(app.getHttpServer())
        .get('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ai = messages.body.data.filter(
        (m: { senderType: string }) => m.senderType === MessageSenderType.Ai,
      );
      if (ai.length > 0) return ai.at(-1).content ?? '';
      await wait(300);
    }
    throw new Error('AI never replied');
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);
    await dataSource.query(
      'TRUNCATE audit_logs, tool_executions, ai_agent_tools, ai_tools, order_items, orders, products, notifications, knowledge_chunks, ai_agent_knowledge_bases, knowledge_documents, knowledge_bases, ai_usage_logs, messages, conversations, customer_sessions, customers, ai_agents, refresh_tokens, users, organizations CASCADE',
    );

    const organizations = app.get(OrganizationsService);
    const users = app.get(UsersService);

    orgSlug = `tools-${Date.now()}`;
    const org = await organizations.create('Tools Co', orgSlug);
    organizationId = org.id;

    await users.create({
      organizationId,
      email: 'owner@tools.test',
      password,
      name: 'Tools Owner',
      role: UserRole.Owner,
    });
    await users.create({
      organizationId,
      email: 'agent@tools.test',
      password,
      name: 'Tools Agent',
      role: UserRole.Agent,
    });

    const agents = dataSource.getRepository(AiAgentEntity);
    agentId = (
      await agents.save(
        agents.create({
          organizationId,
          name: 'Tools AI',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true,
          isActive: true,
          ragEnabled: false,
        }),
      )
    ).id;

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@tools.test', password })
        .expect(200)
    ).body.data.accessToken;

    agentUserToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'agent@tools.test', password })
        .expect(200)
    ).body.data.accessToken;

    // Register the code registry into this organization.
    const registered = await app.get(ToolsAdminService).syncRegistry(organizationId);
    toolIds = Object.fromEntries(registered.map((tool) => [tool.name, tool.id]));

    // Business fixtures.
    await dataSource.query(
      `INSERT INTO products (organization_id, sku, name, price_cents, stock_quantity, attributes)
       VALUES ($1,'IP17P-BLK','iPhone 17 Pro',4290000,5,'{"color":"black"}'::jsonb),
              ($1,'IP17P-WHT','iPhone 17 Pro',4290000,0,'{"color":"white"}'::jsonb)`,
      [organizationId],
    );
    const customer = await dataSource.query(
      `INSERT INTO customers (organization_id, name) VALUES ($1,'Order Owner') RETURNING id`,
      [organizationId],
    );
    customerId = customer[0].id;
    await dataSource.query(
      `INSERT INTO orders (organization_id, customer_id, order_number, status, total_cents, tracking_number)
       VALUES ($1,NULL,'5678','SHIPPED',4290000,'TH999888777')`,
      [organizationId],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('registry', () => {
    it('registers exactly the tools the code implements', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/tools')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const names = response.body.data.map((t: { name: string }) => t.name).sort();
      expect(names).toEqual(['getOrderStatus', 'getProduct', 'getProductStock']);
    });

    it('stores a JSON Schema derived from the Zod schema', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/tools')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const orderTool = response.body.data.find(
        (t: { name: string }) => t.name === 'getOrderStatus',
      );
      expect(orderTool.inputSchema).toMatchObject({
        type: 'object',
        required: ['orderId'],
        additionalProperties: false,
      });
    });

    it('all MVP tools are read-only', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/tools')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.every((t: { mutating: boolean }) => !t.mutating)).toBe(true);
    });
  });

  describe('permission allowlist (§25)', () => {
    it('does not call a tool the agent is not allowed to use', async () => {
      // No allowlist rows yet — the registry knows the tool but the agent
      // may not reach it.
      const session = await startChat();
      await ask(session, 'iPhone 17 Pro ราคาเท่าไหร่ครับ');

      const executions = await dataSource.query(
        `SELECT count(*)::int AS c FROM tool_executions WHERE organization_id = $1 AND status = 'SUCCESS'`,
        [organizationId],
      );
      expect(executions[0].c).toBe(0);
    });

    it('grants tools through the agent allowlist', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toolIds: Object.values(toolIds) })
        .expect(200);

      expect(response.body.data.toolIds).toHaveLength(3);
    });

    it("refuses to link a tool from another organization", async () => {
      const organizations = app.get(OrganizationsService);
      const other = await organizations.create('Other', `other-${Date.now()}`);
      const otherTool = await dataSource.query(
        `INSERT INTO ai_tools (organization_id, name, description, input_schema)
         VALUES ($1,'getProduct','x','{}'::jsonb) RETURNING id`,
        [other.id],
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toolIds: [otherTool[0].id] })
        .expect(404);

      // Restore the real allowlist.
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ toolIds: Object.values(toolIds) })
        .expect(200);
    });
  });

  describe('execution (§26)', () => {
    it('answers a price question from the product table', async () => {
      const session = await startChat();
      const reply = await ask(session, 'iPhone 17 Pro ราคาเท่าไหร่ครับ');

      // 42900 is 4290000 minor units — it can only come from the row.
      expect(reply).toContain('42900');
    });

    it('answers a stock question with live quantities', async () => {
      const session = await startChat();
      const reply = await ask(session, 'iPhone 17 Pro สีดำ มีของไหมครับ');

      expect(reply).toContain('"stockQuantity":5');
      expect(reply).toContain('"inStock":false'); // the white variant
    });

    it('answers an order question with the real tracking number', async () => {
      const session = await startChat();
      const reply = await ask(session, 'คำสั่งซื้อ 5678 ถึงไหนแล้วครับ');

      expect(reply).toContain('TH999888777');
      expect(reply).toContain('SHIPPED');
    });

    it('logs every call with its input, output and duration', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/tool-executions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const successes = response.body.data.filter(
        (e: { status: string }) => e.status === ToolExecutionStatus.Success,
      );
      expect(successes.length).toBeGreaterThanOrEqual(3);
      expect(successes[0].input).toBeTruthy();
      expect(successes[0].output).toBeTruthy();
      expect(typeof successes[0].durationMs).toBe('number');
    });

    it('does not invent data when the tool finds nothing', async () => {
      const session = await startChat();
      const reply = await ask(session, 'Galaxy Z Fold 9 ราคาเท่าไหร่ครับ');

      // A product that does not exist must produce found:false, never a
      // plausible-looking price.
      expect(reply).toContain('"found":false');
      expect(reply).not.toMatch(/\d{4,}/);
    });
  });

  describe('order ownership', () => {
    it("will not reveal another customer's order", async () => {
      await dataSource.query(
        `INSERT INTO orders (organization_id, customer_id, order_number, status, total_cents)
         VALUES ($1,$2,'9999','DELIVERED',100000)`,
        [organizationId, customerId],
      );

      // Order numbers are guessable; organization scoping alone would let any
      // customer read this one just by asking.
      const session = await startChat();
      const reply = await ask(session, 'คำสั่งซื้อ 9999 ถึงไหนแล้วครับ');

      expect(reply).toContain('not_owned_by_this_customer');
      expect(reply).not.toContain('DELIVERED');
    });
  });

  describe('tenant isolation', () => {
    it("never returns another organization's products", async () => {
      const organizations = app.get(OrganizationsService);
      const other = await organizations.create('Rival', `rival-${Date.now()}`);
      await dataSource.query(
        `INSERT INTO products (organization_id, sku, name, price_cents, stock_quantity)
         VALUES ($1,'SECRET-1','iPhone 17 Pro',1,999)`,
        [other.id],
      );

      const session = await startChat();
      const reply = await ask(session, 'iPhone 17 Pro ราคาเท่าไหร่ครับ');

      expect(reply).not.toContain('SECRET-1');
      expect(reply).not.toContain('999');
    });
  });

  describe('approval flow', () => {
    let executionId: string;

    beforeAll(async () => {
      // Flip a read tool to require approval, which is what an org would do
      // for a sensitive read — the mutating path uses the same gate.
      await dataSource.query(
        `UPDATE ai_agent_tools SET requires_approval = true
          WHERE ai_agent_id = $1 AND ai_tool_id = $2`,
        [agentId, toolIds.getOrderStatus],
      );

      const session = await startChat();
      await ask(session, 'คำสั่งซื้อ 5678 ถึงไหนแล้วครับ');
    });

    it('holds the call as PENDING_APPROVAL instead of executing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/tool-executions')
        .query({ status: ToolExecutionStatus.PendingApproval })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThan(0);
      executionId = response.body.data[0].id;
      expect(response.body.data[0].output).toBeNull();
    });

    it('lets an admin with ai.write approve it', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/tool-executions/${executionId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.status).toBe(ToolExecutionStatus.Approved);
      expect(response.body.data.approvedByUserId).toBeTruthy();
    });

    it('refuses to approve the same call twice', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/tool-executions/${executionId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('denies an AGENT the ability to approve', async () => {
      // Approving a data change is a heavier decision than replying.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/tool-executions/${executionId}/reject`)
        .set('Authorization', `Bearer ${agentUserToken}`)
        .send({})
        .expect(403);
    });

    it('writes an audit entry for the approval (§42)', async () => {
      const rows = await dataSource.query(
        `SELECT action, actor_type FROM audit_logs WHERE resource_id = $1 ORDER BY created_at DESC`,
        [executionId],
      );
      expect(rows.some((r: { action: string }) => r.action === 'tool.approve')).toBe(true);
    });

    it('audits AI-initiated tool executions separately from user actions', async () => {
      const rows = await dataSource.query(
        `SELECT count(*)::int AS c FROM audit_logs
          WHERE organization_id = $1 AND action = 'tool.execute' AND actor_type = 'AI'`,
        [organizationId],
      );
      expect(rows[0].c).toBeGreaterThan(0);
    });
  });
});
