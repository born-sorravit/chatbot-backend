import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHmac } from 'node:crypto';
import { AppModule } from '@/app.module';
import { UsersService } from '@/modules/users/users.service';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { AiAgentEntity } from '@/models/entities';
import { DEFAULT_SYSTEM_PROMPT } from '@/modules/ai/prompts/prompt.service';
import { LineAdapter } from '@/modules/channels/adapters/line.adapter';
import { ChannelType, MessageSenderType, UserRole } from '@/shared/constants';

/**
 * Phase 8 acceptance (master plan §47): a second channel works without
 * touching AI core.
 *
 * The suite exercises the whole external path — signed webhook in, customer
 * and conversation resolved, message stored, AI woken, reply pushed back out
 * — plus the things that make a *public* endpoint safe: signature rejection,
 * tenant isolation, and idempotency under provider retries.
 *
 * Only `LineAdapter.send` is stubbed, and only because it is an HTTP call to
 * LINE. Verification, parsing, routing, storage and delivery scheduling all
 * run for real.
 */
describe('External channels (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let sent: Array<{ externalUserId: string; text: string; replyToken?: string | null }>;

  const password = 'Password123!';
  const LINE_SECRET = 'org-a-line-secret';
  const OTHER_SECRET = 'org-b-line-secret';

  let orgA: string;
  let orgB: string;
  let ownerToken: string;
  let agentToken: string;
  let integrationA: string;
  let integrationB: string;

  const api = () => request(app.getHttpServer());
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Waits for a delivery matching `predicate`.
   *
   * Deliberately not "wait for the next send": AI replies triggered by
   * earlier tests are still working through the queue, so the next arrival is
   * frequently someone else's. Matching on content is what makes these
   * assertions about the message under test.
   */
  async function waitForSend(
    predicate: (entry: { externalUserId: string; text: string; replyToken?: string | null }) => boolean,
    timeoutMs = 25_000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const match = sent.find(predicate);
      if (match) return match;
      await wait(200);
    }
    throw new Error(`No delivery matched within ${timeoutMs}ms. Saw: ${JSON.stringify(sent)}`);
  }

  /** Waits until the delivery queue stops producing, so a later assertion
   *  about "nothing was sent" is not fooled by earlier in-flight work. */
  async function drain(quietMs = 2000): Promise<void> {
    let lastCount = -1;
    while (lastCount !== sent.length) {
      lastCount = sent.length;
      await wait(quietMs);
    }
  }

  /** Posts a raw body with a correct LINE signature for `secret`. */
  function postWebhook(integrationId: string, body: string, secret: string | null) {
    const req = api()
      .post(`/api/v1/webhooks/line/${integrationId}`)
      .set('Content-Type', 'application/json');

    if (secret !== null) {
      req.set('x-line-signature', createHmac('sha256', secret).update(body).digest('base64'));
    }

    // `.send(string)` keeps the exact bytes — `.send(object)` would let
    // supertest re-serialise and the signature would no longer match, which
    // is the very failure this phase's raw-body handling exists to avoid.
    return req.send(body);
  }

  function lineBody(opts: { userId: string; messageId: string; text: string; replyToken?: string }) {
    return JSON.stringify({
      destination: 'Udestination',
      events: [
        {
          type: 'message',
          replyToken: opts.replyToken ?? 'reply-token-1',
          source: { userId: opts.userId, type: 'user' },
          message: { id: opts.messageId, type: 'text', text: opts.text },
        },
      ],
    });
  }

  async function createIntegration(token: string, secret: string, accountId: string) {
    const response = await api()
      .post('/api/v1/admin/channels')
      .set('Authorization', `Bearer ${token}`)
      .send({
        channel: 'line',
        displayName: 'LINE Official',
        externalAccountId: accountId,
        credentials: { channelSecret: secret, accessToken: 'line-access-token' },
      })
      .expect(201);

    return response.body.data.id as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    // rawBody mirrors main.ts — without it `req.rawBody` is undefined and
    // every signature check fails, so the e2e app must be built the same way
    // the real one is.
    app = moduleRef.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.listen(0);

    dataSource = app.get(DataSource);
    await dataSource.query(
      'TRUNCATE audit_logs, tool_executions, ai_agent_tools, ai_tools, order_items, orders, products, notifications, knowledge_chunks, ai_agent_knowledge_bases, knowledge_documents, knowledge_bases, ai_usage_logs, messages, conversations, customer_channel_identities, channel_integrations, customer_sessions, customers, ai_agents, refresh_tokens, users, organizations CASCADE',
    );

    // Intercept only the outbound HTTP call to LINE.
    sent = [];
    jest
      .spyOn(app.get(LineAdapter), 'send')
      .mockImplementation(async (_credentials, message) => {
        sent.push({
          externalUserId: message.externalUserId,
          text: message.text,
          replyToken: message.replyToken,
        });
      });

    const organizations = app.get(OrganizationsService);
    const users = app.get(UsersService);

    orgA = (await organizations.create('Channel Co', `chan-a-${Date.now()}`)).id;
    orgB = (await organizations.create('Rival Co', `chan-b-${Date.now()}`)).id;

    for (const [organizationId, email, role] of [
      [orgA, 'owner@chan.test', UserRole.Owner],
      [orgA, 'agent@chan.test', UserRole.Agent],
      [orgB, 'owner@rival.test', UserRole.Owner],
    ] as const) {
      await users.create({ organizationId, email, password, name: email, role });
    }

    ownerToken = (
      await api().post('/api/v1/auth/login').send({ email: 'owner@chan.test', password })
    ).body.data.accessToken;
    agentToken = (
      await api().post('/api/v1/auth/login').send({ email: 'agent@chan.test', password })
    ).body.data.accessToken;
    const rivalToken = (
      await api().post('/api/v1/auth/login').send({ email: 'owner@rival.test', password })
    ).body.data.accessToken;

    // Both organizations need a default agent for the AI to reply.
    const agents = dataSource.getRepository(AiAgentEntity);
    for (const organizationId of [orgA, orgB]) {
      await agents.save(
        agents.create({
          organizationId,
          name: 'Channel AI',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true,
          isActive: true,
          ragEnabled: false,
        }),
      );
    }

    integrationA = await createIntegration(ownerToken, LINE_SECRET, 'Udestination');
    integrationB = await createIntegration(rivalToken, OTHER_SECRET, 'Uother');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
  });

  describe('admin API', () => {
    it('never returns credential values', async () => {
      const response = await api()
        .get('/api/v1/admin/channels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain(LINE_SECRET);
      expect(body).not.toContain('line-access-token');

      // Reports which keys are set, never what they are.
      expect(response.body.data[0].credentialStatus).toEqual({
        channelSecret: true,
        accessToken: true,
      });
    });

    it('hands the admin the webhook path to paste into the provider', async () => {
      const response = await api()
        .get('/api/v1/admin/channels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data[0].webhookPath).toBe(`/webhooks/line/${integrationA}`);
    });

    it('refuses an AGENT', async () => {
      // Connecting a channel opens a path into the inbox — owner-level work.
      await api()
        .get('/api/v1/admin/channels')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });

    it('rejects an integration missing required credentials', async () => {
      await api()
        .post('/api/v1/admin/channels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          channel: 'facebook',
          displayName: 'Page',
          credentials: { appSecret: 'only-one' },
        })
        .expect(400);
    });

    it('refuses to connect the built-in web widget', async () => {
      await api()
        .post('/api/v1/admin/channels')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ channel: 'web', displayName: 'Widget', credentials: {} })
        .expect(400);
    });

    it('returns 404 for another organization integration', async () => {
      await api()
        .get(`/api/v1/admin/channels/${integrationB}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });
  });

  describe('webhook authentication', () => {
    it('rejects an unsigned payload with 404', async () => {
      await postWebhook(integrationA, lineBody({ userId: 'U0', messageId: 'm0', text: 'hi' }), null)
        .expect(404);
    });

    it('rejects a payload signed with the wrong secret', async () => {
      await postWebhook(
        integrationA,
        lineBody({ userId: 'U0', messageId: 'm0', text: 'hi' }),
        'wrong-secret',
      ).expect(404);
    });

    it('rejects a valid signature replayed at another organization integration', async () => {
      // Correctly signed for org A, posted at org B's endpoint. Accepting it
      // would let one tenant inject messages into another's inbox (R-01).
      await postWebhook(
        integrationB,
        lineBody({ userId: 'U0', messageId: 'm0', text: 'hi' }),
        LINE_SECRET,
      ).expect(404);
    });

    it('returns 404 — not 403 — for an unknown integration id', async () => {
      // A distinguishable response would let someone enumerate which
      // integrations exist.
      await postWebhook(
        '00000000-0000-4000-8000-000000000000',
        lineBody({ userId: 'U0', messageId: 'm0', text: 'hi' }),
        LINE_SECRET,
      ).expect(404);
    });

    it('stored nothing for any rejected request', async () => {
      const [{ count }] = await dataSource.query('SELECT count(*)::int AS count FROM messages');
      expect(count).toBe(0);
    });
  });

  describe('inbound', () => {
    it('creates customer, identity and conversation on first contact', async () => {
      await postWebhook(
        integrationA,
        lineBody({ userId: 'Ucustomer1', messageId: 'msg-1', text: 'สวัสดีครับ' }),
        LINE_SECRET,
      ).expect(200);

      const identities = await dataSource.query(
        `SELECT * FROM customer_channel_identities WHERE organization_id = $1`,
        [orgA],
      );
      expect(identities).toHaveLength(1);
      expect(identities[0].external_user_id).toBe('Ucustomer1');
      expect(identities[0].channel).toBe(ChannelType.Line);

      const conversations = await dataSource.query(
        `SELECT * FROM conversations WHERE organization_id = $1`,
        [orgA],
      );
      expect(conversations).toHaveLength(1);
      // The channel is recorded so the inbox and the delivery worker both
      // know where this customer lives.
      expect(conversations[0].channel).toBe(ChannelType.Line);

      const messages = await dataSource.query(
        `SELECT * FROM messages WHERE organization_id = $1 ORDER BY created_at`,
        [orgA],
      );
      expect(messages[0].sender_type).toBe(MessageSenderType.Customer);
      expect(messages[0].content).toBe('สวัสดีครับ');
      expect(messages[0].external_id).toBe('msg-1');
    });

    it('resumes the same conversation for the same LINE user', async () => {
      await postWebhook(
        integrationA,
        lineBody({ userId: 'Ucustomer1', messageId: 'msg-2', text: 'ราคาเท่าไหร่' }),
        LINE_SECRET,
      ).expect(200);

      const conversations = await dataSource.query(
        `SELECT * FROM conversations WHERE organization_id = $1`,
        [orgA],
      );
      expect(conversations).toHaveLength(1);
    });

    it('is idempotent when the provider retries a webhook', async () => {
      const body = lineBody({ userId: 'Ucustomer1', messageId: 'msg-retry', text: 'ซ้ำ' });

      const first = await postWebhook(integrationA, body, LINE_SECRET).expect(200);
      const second = await postWebhook(integrationA, body, LINE_SECRET).expect(200);

      expect(first.body.data).toEqual({ received: 1, duplicates: 0 });
      // 200 with duplicates counted, not a 500 — anything else and the
      // provider keeps retrying forever.
      expect(second.body.data).toEqual({ received: 1, duplicates: 1 });

      const [{ count }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM messages WHERE external_id = 'msg-retry'`,
      );
      expect(count).toBe(1);
    });

    it('keeps two organizations LINE users apart', async () => {
      // The same LINE user id reaching two businesses is two customers —
      // each carries that business's own notes and tags.
      await postWebhook(
        integrationB,
        JSON.stringify({
          destination: 'Uother',
          events: [
            {
              type: 'message',
              replyToken: 'rt',
              source: { userId: 'Ucustomer1', type: 'user' },
              message: { id: 'b-msg-1', type: 'text', text: 'hello rival' },
            },
          ],
        }),
        OTHER_SECRET,
      ).expect(200);

      const [{ count: orgACount }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM customers WHERE organization_id = $1`,
        [orgA],
      );
      const [{ count: orgBCount }] = await dataSource.query(
        `SELECT count(*)::int AS count FROM customers WHERE organization_id = $1`,
        [orgB],
      );

      expect(orgACount).toBe(1);
      expect(orgBCount).toBe(1);
    });
  });

  describe('outbound', () => {
    it('pushes the AI reply back to LINE', async () => {
      // A customer of its own. Ucustomer1 already has several AI jobs in
      // flight from the inbound tests, and the reply token belongs to the
      // message that *triggered* a job — so with a queue backlog the token on
      // any given delivery is legitimately an earlier one. A fresh customer
      // makes the mapping unambiguous.
      await postWebhook(
        integrationA,
        lineBody({
          userId: 'Uoutbound',
          messageId: 'msg-ai',
          text: 'สอบถามเรื่องการจัดส่ง',
          replyToken: 'rt-ai',
        }),
        LINE_SECRET,
      ).expect(200);

      const delivered = await waitForSend((entry) => entry.externalUserId === 'Uoutbound');

      expect(delivered.text.length).toBeGreaterThan(0);
      // The reply token from the triggering message is threaded through:
      // LINE bills push but not reply, so picking the right one is money.
      expect(delivered.replyToken).toBe('rt-ai');
    });

    it('pushes an admin reply too', async () => {
      const conversation = (
        await dataSource.query(
          `SELECT id FROM conversations WHERE organization_id = $1 LIMIT 1`,
          [orgA],
        )
      )[0];

      await api()
        .post(`/api/v1/admin/conversations/${conversation.id}/messages`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ content: 'เจ้าหน้าที่ตอบกลับครับ' })
        .expect(201);

      const delivered = await waitForSend((entry) => entry.text === 'เจ้าหน้าที่ตอบกลับครับ');

      // An admin message has no triggering customer message, so no reply
      // token — the adapter correctly falls back to the push API.
      expect(delivered.replyToken).toBeNull();
    });

    it('never delivers a web conversation to a channel', async () => {
      // Let every in-flight AI reply finish first, so what follows measures
      // only the web message.
      await drain();
      const before = sent.length;

      const session = await api()
        .post('/api/v1/chat/sessions')
        .send({ organizationSlug: await orgSlug(), name: 'Web Customer' })
        .expect(201);

      await api()
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${session.body.data.sessionToken}`)
        .send({ content: 'hello from the widget' })
        .expect(201);

      // Long enough for the AI to have replied over the widget's WebSocket.
      await wait(6000);

      // The widget customer has no LINE identity and the conversation's
      // channel is 'web', so nothing should have gone out to a provider.
      expect(sent.slice(before)).toEqual([]);
    });
  });

  async function orgSlug(): Promise<string> {
    const [row] = await dataSource.query(`SELECT slug FROM organizations WHERE id = $1`, [orgA]);
    return row.slug;
  }
});
