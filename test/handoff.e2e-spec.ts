import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { UsersService } from '@/modules/users/users.service';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { AiAgentEntity, MessageEntity } from '@/models/entities';
import { DEFAULT_SYSTEM_PROMPT } from '@/modules/ai/prompts/prompt.service';
import {
  ConversationMode,
  HandoffReason,
  MessageSenderType,
  NotificationType,
  UserRole,
} from '@/shared/constants';

/**
 * Phase 5 acceptance (master plan §47, §53):
 *
 *   AI → customer requests human → AI stops → admin notified →
 *   admin takes over → admin replies → return to AI
 */
describe('Human handoff (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;

  const password = 'Password123!';
  let orgSlug: string;
  let organizationId: string;
  let adminToken: string;
  let agentUserToken: string;
  let agentId: string;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function startChat(): Promise<{ token: string; conversationId: string }> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ organizationSlug: orgSlug, name: 'Handoff Customer' })
      .expect(201);
    return {
      token: response.body.data.sessionToken,
      conversationId: response.body.data.conversation.id,
    };
  }

  async function send(token: string, content: string) {
    await request(app.getHttpServer())
      .post('/api/v1/chat/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ content })
      .expect(201);
  }

  async function aiReplyCount(conversationId: string): Promise<number> {
    return dataSource.getRepository(MessageEntity).count({
      where: { conversationId, senderType: MessageSenderType.Ai },
    });
  }

  async function waitForAi(conversationId: string, timeoutMs = 20_000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const count = await aiReplyCount(conversationId);
      if (count > 0) return count;
      await wait(250);
    }
    return 0;
  }

  async function conversationRow(conversationId: string) {
    const rows = await dataSource.query(
      'SELECT mode, status, handoff_reason, assigned_user_id FROM conversations WHERE id = $1',
      [conversationId],
    );
    return rows[0];
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
    baseUrl = (await app.getUrl()).replace('[::1]', 'localhost');

    dataSource = app.get(DataSource);
    await dataSource.query(
      'TRUNCATE notifications, knowledge_chunks, ai_agent_knowledge_bases, knowledge_documents, knowledge_bases, ai_usage_logs, messages, conversations, customer_sessions, customers, ai_agents, refresh_tokens, users, organizations CASCADE',
    );

    const organizations = app.get(OrganizationsService);
    const users = app.get(UsersService);

    orgSlug = `handoff-${Date.now()}`;
    const org = await organizations.create('Handoff Co', orgSlug);
    organizationId = org.id;

    await users.create({
      organizationId,
      email: 'owner@handoff.test',
      password,
      name: 'Handoff Owner',
      role: UserRole.Owner,
    });
    await users.create({
      organizationId,
      email: 'agent@handoff.test',
      password,
      name: 'Handoff Agent',
      role: UserRole.Agent,
    });

    const agents = dataSource.getRepository(AiAgentEntity);
    agentId = (
      await agents.save(
        agents.create({
          organizationId,
          name: 'Handoff AI',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true,
          isActive: true,
          // No knowledge base linked, so RAG never runs and the stub's
          // keyword branches decide the outcome deterministically.
          ragEnabled: false,
        }),
      )
    ).id;

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@handoff.test', password })
        .expect(200)
    ).body.data.accessToken;

    agentUserToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'agent@handoff.test', password })
        .expect(200)
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('customer requests a human (§53)', () => {
    let session: { token: string; conversationId: string };

    it('flips to HUMAN with CUSTOMER_REQUESTED', async () => {
      session = await startChat();

      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/request-human')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      expect(response.body.data.mode).toBe(ConversationMode.Human);

      const row = await conversationRow(session.conversationId);
      expect(row.handoff_reason).toBe(HandoffReason.CustomerRequested);
    });

    it('records a SYSTEM message so the transcript shows why', async () => {
      const systemMessages = await dataSource.getRepository(MessageEntity).find({
        where: { conversationId: session.conversationId, senderType: MessageSenderType.System },
      });
      expect(systemMessages.some((m) => m.content?.includes('ขอคุยกับเจ้าหน้าที่'))).toBe(true);
    });

    it('stops the AI replying from then on', async () => {
      const before = await aiReplyCount(session.conversationId);

      await send(session.token, 'ยังอยู่ไหมครับ');
      await wait(4_000);

      expect(await aiReplyCount(session.conversationId)).toBe(before);
    });

    it('notifies admins who can reply', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const requested = response.body.data.filter(
        (n: { type: string }) => n.type === NotificationType.CustomerRequestedHuman,
      );
      expect(requested.length).toBeGreaterThan(0);
      expect(response.body.meta.unreadCount).toBeGreaterThan(0);
    });

    it('is idempotent — pressing it again does not stack system messages', async () => {
      const before = await dataSource.getRepository(MessageEntity).count({
        where: { conversationId: session.conversationId, senderType: MessageSenderType.System },
      });

      await request(app.getHttpServer())
        .post('/api/v1/chat/request-human')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      expect(
        await dataSource.getRepository(MessageEntity).count({
          where: { conversationId: session.conversationId, senderType: MessageSenderType.System },
        }),
      ).toBe(before);
    });
  });

  describe('automatic handoff', () => {
    it('hands off when the AI cannot answer safely', async () => {
      const session = await startChat();

      // The stub returns HANDOFF for an explicit human request in the text.
      await send(session.token, 'ขอคุยกับพนักงานครับ');
      await waitForAi(session.conversationId);
      await wait(500);

      const row = await conversationRow(session.conversationId);
      expect(row.mode).toBe(ConversationMode.Human);
      expect(row.handoff_reason).toBeTruthy();
    });

    it('raises an AI_HANDOFF notification', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        response.body.data.some((n: { type: string }) => n.type === NotificationType.AiHandoff),
      ).toBe(true);
    });
  });

  describe('take over (§30) and return to AI (§31)', () => {
    let session: { token: string; conversationId: string };

    beforeAll(async () => {
      session = await startChat();
      await send(session.token, 'สวัสดีครับ');
      await waitForAi(session.conversationId);
    });

    it('assigns the conversation and flips to HUMAN', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session.conversationId}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.mode).toBe(ConversationMode.Human);
      expect(response.body.data.assignedUser?.name).toBe('Handoff Owner');
    });

    it('records who took over', async () => {
      const messages = await dataSource.getRepository(MessageEntity).find({
        where: { conversationId: session.conversationId, senderType: MessageSenderType.System },
      });
      expect(messages.some((m) => m.content?.includes('รับช่วงการสนทนาต่อจาก AI'))).toBe(true);
    });

    it('is idempotent — taking over twice adds no second system message', async () => {
      const before = await dataSource.getRepository(MessageEntity).count({
        where: { conversationId: session.conversationId, senderType: MessageSenderType.System },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session.conversationId}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        await dataSource.getRepository(MessageEntity).count({
          where: { conversationId: session.conversationId, senderType: MessageSenderType.System },
        }),
      ).toBe(before);
    });

    it('lets the admin reply while the AI stays silent', async () => {
      const before = await aiReplyCount(session.conversationId);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session.conversationId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'ผมดูแลต่อเองครับ' })
        .expect(201);

      await send(session.token, 'ขอบคุณครับ');
      await wait(4_000);

      expect(await aiReplyCount(session.conversationId)).toBe(before);
    });

    it('returns control to the AI and clears the handoff reason', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session.conversationId}/return-to-ai`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.mode).toBe(ConversationMode.Ai);
      expect(response.body.data.handoffReason).toBeNull();
    });

    it('lets the AI answer again, keeping the earlier transcript', async () => {
      const before = await aiReplyCount(session.conversationId);

      await send(session.token, 'สอบถามเพิ่มครับ');

      const deadline = Date.now() + 20_000;
      let after = before;
      while (Date.now() < deadline && after === before) {
        after = await aiReplyCount(session.conversationId);
        await wait(250);
      }

      expect(after).toBeGreaterThan(before);

      // §31: context is not cleared, so the admin's turn is still there.
      const messages = await dataSource.getRepository(MessageEntity).find({
        where: { conversationId: session.conversationId, senderType: MessageSenderType.Admin },
      });
      expect(messages.length).toBeGreaterThan(0);
    });

    it('refuses to return to AI when no agent is configured', async () => {
      await dataSource
        .getRepository(AiAgentEntity)
        .update({ id: agentId }, { isActive: false });

      const session2 = await startChat();
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session2.conversationId}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Handing back to an AI that cannot run would strand the customer.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session2.conversationId}/return-to-ai`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      await dataSource
        .getRepository(AiAgentEntity)
        .update({ id: agentId }, { isActive: true });
    });
  });

  describe('notifications', () => {
    it('delivers a notification over the admin socket', async () => {
      const socket: Socket = await new Promise((resolve, reject) => {
        const s = io(`${baseUrl}/ws/admin`, {
          auth: { token: adminToken },
          transports: ['websocket'],
          reconnection: false,
        });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });

      const received: Record<string, unknown>[] = [];
      socket.on('notification:new', (n) => received.push(n));

      const session = await startChat();
      await request(app.getHttpServer())
        .post('/api/v1/chat/request-human')
        .set('Authorization', `Bearer ${session.token}`)
        .expect(200);

      await wait(1_000);
      expect(received.length).toBeGreaterThan(0);
      socket.close();
    });

    it('marks one notification read without touching the rest', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const target = before.body.data[0];

      await request(app.getHttpServer())
        .post(`/api/v1/admin/notifications/${target.id}/read`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const after = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(after.body.meta.unreadCount).toBe(before.body.meta.unreadCount - 1);
    });

    it('marks everything read', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/admin/notifications/read-all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.meta.unreadCount).toBe(0);
    });

    it("never shows one admin another admin's notifications", async () => {
      // Read state is personal; the endpoint has no way to target a user id.
      const owner = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const agent = await request(app.getHttpServer())
        .get('/api/v1/admin/notifications')
        .set('Authorization', `Bearer ${agentUserToken}`)
        .expect(200);

      // The owner marked everything read; the agent's own copies are untouched.
      expect(owner.body.meta.unreadCount).toBe(0);
      expect(agent.body.meta.unreadCount).toBeGreaterThan(0);

      const ownerIds = owner.body.data.map((n: { id: string }) => n.id);
      const agentIds = agent.body.data.map((n: { id: string }) => n.id);
      expect(ownerIds.filter((id: string) => agentIds.includes(id))).toHaveLength(0);
    });
  });

  describe('RBAC and isolation', () => {
    it('lets an AGENT take over — that is their job', async () => {
      const session = await startChat();
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${session.conversationId}/takeover`)
        .set('Authorization', `Bearer ${agentUserToken}`)
        .expect(200);
    });

    it("returns 404 for another organization's conversation", async () => {
      const organizations = app.get(OrganizationsService);
      const other = await organizations.create('Other', `other-${Date.now()}`);
      const customer = await dataSource.query(
        `INSERT INTO customers (organization_id, name) VALUES ($1, 'x') RETURNING id`,
        [other.id],
      );
      const conversation = await dataSource.query(
        `INSERT INTO conversations (organization_id, customer_id) VALUES ($1, $2) RETURNING id`,
        [other.id, customer[0].id],
      );

      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${conversation[0].id}/takeover`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
