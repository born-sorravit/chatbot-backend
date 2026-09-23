import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { UsersService } from '@/modules/users/users.service';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { AiAgentEntity, ConversationEntity, MessageEntity } from '@/models/entities';
import { DEFAULT_SYSTEM_PROMPT } from '@/modules/ai/prompts/prompt.service';
import { AiOrchestrator } from '@/modules/ai/orchestrator/ai-orchestrator.service';
import { ConversationMode, MessageSenderType, UserRole } from '@/shared/constants';

/**
 * Phase 3 acceptance (master plan §47):
 *   Customer → Message → AI Worker → LLM → AI Message → Customer
 *
 * Runs against the stub LLM provider (`LLM_PROVIDER=stub`), which is a real
 * implementation of the provider interface rather than a test double — so
 * everything between the queue and the socket is the production path. Only
 * the HTTP call to Anthropic is substituted.
 */
describe('AI orchestration (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;

  const password = 'Password123!';
  let orgSlug: string;
  let adminToken: string;
  let sessionToken: string;
  let conversationId: string;
  let agentId: string;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** Polls until the AI has replied, rather than sleeping a fixed guess. */
  async function waitForAiMessage(timeoutMs = 20_000): Promise<MessageEntity | null> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const found = await dataSource.getRepository(MessageEntity).findOne({
        where: { conversationId, senderType: MessageSenderType.Ai },
        order: { createdAt: 'DESC' },
      });
      if (found) return found;
      await wait(250);
    }

    return null;
  }

  async function startSession(): Promise<void> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ organizationSlug: orgSlug, name: 'AI Customer' })
      .expect(201);

    sessionToken = response.body.data.sessionToken;
    conversationId = response.body.data.conversation.id;
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
      'TRUNCATE ai_usage_logs, message_attachments, messages, conversations, customer_sessions, customers, ai_agents, refresh_tokens, users, organizations CASCADE',
    );

    const organizations = app.get(OrganizationsService);
    const users = app.get(UsersService);

    orgSlug = `ai-acme-${Date.now()}`;
    const org = await organizations.create('AI Acme', orgSlug);

    await users.create({
      organizationId: org.id,
      email: 'owner@ai-acme.test',
      password,
      name: 'AI Acme Owner',
      role: UserRole.Owner,
    });

    const agents = dataSource.getRepository(AiAgentEntity);
    const agent = await agents.save(
      agents.create({
        organizationId: org.id,
        name: 'Support AI',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        isDefault: true,
        isActive: true,
      }),
    );
    agentId = agent.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@ai-acme.test', password })
      .expect(200);
    adminToken = login.body.data.accessToken;

    await startSession();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Customer → queue → worker → AI reply', () => {
    it('answers a customer message without blocking the HTTP request', async () => {
      const started = Date.now();

      await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'สวัสดีครับ' })
        .expect(201);

      // The §4.1 boundary: the POST must return long before any model call
      // could have completed.
      expect(Date.now() - started).toBeLessThan(2_000);

      const aiMessage = await waitForAiMessage();
      expect(aiMessage).not.toBeNull();
      expect(aiMessage?.content).toBeTruthy();
    });

    it('links the AI reply to the message that triggered it', async () => {
      const aiMessage = await waitForAiMessage();
      expect(aiMessage?.triggerMessageId).toBeTruthy();
    });

    it('records token usage and cost for the request', async () => {
      const usage = await dataSource.query(
        'SELECT purpose, provider, success FROM ai_usage_logs WHERE conversation_id = $1',
        [conversationId],
      );

      // Cost data cannot be backfilled, so it is written from Phase 3 (§44).
      expect(usage.length).toBeGreaterThan(0);
      expect(usage[0].purpose).toBe('response');
      expect(usage[0].success).toBe(true);
    });

    it('delivers the AI reply to the customer over WebSocket', async () => {
      await startSession();

      const socket: Socket = await new Promise((resolve, reject) => {
        const s = io(`${baseUrl}/ws/customer`, {
          auth: { token: sessionToken },
          transports: ['websocket'],
          reconnection: false,
        });
        s.on('connect', () => resolve(s));
        s.on('connect_error', reject);
      });

      const received: Record<string, unknown>[] = [];
      const thinking: Record<string, unknown>[] = [];
      socket.on('message:new', (m) => received.push(m));
      socket.on('ai:thinking', (t) => thinking.push(t));

      await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'ขอบคุณครับ' })
        .expect(201);

      await waitForAiMessage();
      await wait(600);

      const aiEvents = received.filter((m) => m.senderType === MessageSenderType.Ai);
      expect(aiEvents.length).toBeGreaterThan(0);
      // A fixed label, never the agent's internals.
      expect(aiEvents[0].senderName).toBe('AI Assistant');

      // Progress is a status enum, never model-authored text (§32).
      expect(thinking.length).toBeGreaterThan(0);
      expect(typeof thinking[0].status).toBe('string');

      socket.close();
    });
  });

  describe('HUMAN mode stops the AI', () => {
    it('does not reply when the conversation is already in HUMAN mode', async () => {
      await startSession();

      await dataSource
        .getRepository(ConversationEntity)
        .update({ id: conversationId }, { mode: ConversationMode.Human });

      await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'มีใครอยู่ไหมครับ' })
        .expect(201);

      await wait(3_000);

      const aiMessages = await dataSource.getRepository(MessageEntity).count({
        where: { conversationId, senderType: MessageSenderType.Ai },
      });
      expect(aiMessages).toBe(0);
    });

    it('skips a job whose conversation flipped to HUMAN after it was queued', async () => {
      await startSession();

      const customerMessage = await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'อยากคุยกับทีมงาน' })
        .expect(201);

      // The takeover race (R-03): an admin takes over between enqueue and
      // execution. Invoking the orchestrator directly reproduces the window
      // deterministically instead of relying on queue timing.
      await dataSource
        .getRepository(ConversationEntity)
        .update({ id: conversationId }, { mode: ConversationMode.Human });

      const orchestrator = app.get(AiOrchestrator);
      const conversation = await dataSource
        .getRepository(ConversationEntity)
        .findOneOrFail({ where: { id: conversationId } });

      const outcome = await orchestrator.handle({
        organizationId: conversation.organizationId,
        conversationId,
        triggerMessageId: customerMessage.body.data.id,
      });

      expect(outcome.status).toBe('skipped');
    });
  });

  describe('idempotency', () => {
    it('never produces two AI replies for one customer message', async () => {
      await startSession();

      const sent = await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'ทดสอบ idempotency' })
        .expect(201);

      await waitForAiMessage();

      const conversation = await dataSource
        .getRepository(ConversationEntity)
        .findOneOrFail({ where: { id: conversationId } });

      // Re-run the orchestrator on the same trigger, as a retried job would.
      // The partial unique index on trigger_message_id is the backstop when a
      // retry lands outside BullMQ's dedup window (TD-10).
      const orchestrator = app.get(AiOrchestrator);
      await orchestrator
        .handle({
          organizationId: conversation.organizationId,
          conversationId,
          triggerMessageId: sent.body.data.id,
        })
        .catch(() => undefined);

      const replies = await dataSource.getRepository(MessageEntity).count({
        where: {
          conversationId,
          senderType: MessageSenderType.Ai,
          triggerMessageId: sent.body.data.id,
        },
      });

      expect(replies).toBe(1);
    });
  });

  describe('handoff', () => {
    it('flips to HUMAN and records a reason when the AI cannot answer', async () => {
      await startSession();

      // The stub returns HANDOFF for a human request, which is the trigger
      // §53 describes.
      await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'ขอคุยกับพนักงานครับ' })
        .expect(201);

      await waitForAiMessage();
      await wait(400);

      const conversation = await dataSource
        .getRepository(ConversationEntity)
        .findOneOrFail({ where: { id: conversationId } });

      expect(conversation.mode).toBe(ConversationMode.Human);
      expect(conversation.handoffReason).toBeTruthy();
    });

    it('never leaks the internal handoff note to the customer', async () => {
      const messages = await request(app.getHttpServer())
        .get('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      for (const message of messages.body.data) {
        expect(message).not.toHaveProperty('metadata');
        expect(message).not.toHaveProperty('handoffReason');
      }
    });
  });

  describe('AI agent administration', () => {
    it('lists agents for an admin with ai.read', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/ai-agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].systemPrompt).toContain('Never invent prices');
    });

    it('updates the system prompt from the admin API (§17)', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ systemPrompt: `${DEFAULT_SYSTEM_PROMPT}\n\n12. Always mention shipping times.` })
        .expect(200);

      expect(response.body.data.systemPrompt).toContain('Always mention shipping times');
    });

    it('rejects a model outside the allowlist', async () => {
      // Free-text here would let a typo take the AI offline for every customer.
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ model: 'gpt-4' })
        .expect(400);
    });

    it('rejects temperature, which is not a field on this entity', async () => {
      // Current Claude models reject sampling parameters (TD-13).
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ temperature: 0.7 })
        .expect(400);
    });

    it('runs a prompt test without creating any conversation', async () => {
      const before = await dataSource.getRepository(ConversationEntity).count();

      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/ai-agents/${agentId}/test`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: 'คืนสินค้าได้กี่วัน' })
        .expect(200);

      expect(response.body.data.state).toBeTruthy();
      expect(response.body.data.message).toBeTruthy();
      expect(await dataSource.getRepository(ConversationEntity).count()).toBe(before);
    });

    it('keeps exactly one default agent per organization', async () => {
      const created = await request(app.getHttpServer())
        .post('/api/v1/admin/ai-agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Second AI',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true,
        })
        .expect(201);

      const agents = await request(app.getHttpServer())
        .get('/api/v1/admin/ai-agents')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const defaults = agents.body.data.filter((a: { isDefault: boolean }) => a.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].id).toBe(created.body.data.id);
    });
  });
});
