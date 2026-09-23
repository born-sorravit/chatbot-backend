import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { UserRole } from '../src/common/constants';

/**
 * Phase 7 acceptance (master plan §45).
 *
 * Analytics is the one module that reads through raw `dataSource.query`
 * rather than `TenantScopedRepository`, so the tenant filter is hand-written
 * in every WHERE clause and nothing else proves it. These tests exist mainly
 * to hold that line, and to pin the two metric definitions that are easy to
 * get quietly wrong.
 */
describe('Analytics (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let dataSource: DataSource;

  const password = 'Password123!';
  let ownerToken: string;
  let agentToken: string;
  let orgA: string;
  let orgB: string;

  const api = () => request(app.getHttpServer());

  /** Seeds one conversation plus its messages, at controlled timestamps. */
  async function seedConversation(opts: {
    organizationId: string;
    customerId: string;
    status: 'OPEN' | 'PENDING' | 'CLOSED';
    mode: 'AI' | 'HUMAN';
    handoffReason?: string;
    minutesAgo: number;
    closedAfterSeconds?: number;
    /** [senderType, secondsAfterStart] pairs. */
    messages?: Array<[string, number]>;
  }): Promise<string> {
    const created = `now() - interval '${opts.minutesAgo} minutes'`;
    const rows = await dataSource.query(
      `INSERT INTO conversations
         (organization_id, customer_id, status, mode, handoff_reason, handoff_at, created_at, closed_at)
       VALUES ($1, $2, $3::conversation_status, $4::conversation_mode, $5::handoff_reason,
               ${opts.handoffReason ? created : 'NULL'},
               ${created},
               ${
                 opts.closedAfterSeconds != null
                   ? `${created} + interval '${opts.closedAfterSeconds} seconds'`
                   : 'NULL'
               })
       RETURNING id`,
      [opts.organizationId, opts.customerId, opts.status, opts.mode, opts.handoffReason ?? null],
    );

    const conversationId = rows[0].id;

    for (const [senderType, offset] of opts.messages ?? []) {
      await dataSource.query(
        `INSERT INTO messages (organization_id, conversation_id, sender_type, content, created_at)
         VALUES ($1, $2, $3::message_sender_type, 'x', ${created} + interval '${offset} seconds')`,
        [opts.organizationId, conversationId, senderType],
      );
    }

    return conversationId;
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

    orgA = (await organizations.create('Metrics Co', `metrics-a-${Date.now()}`)).id;
    orgB = (await organizations.create('Rival Co', `metrics-b-${Date.now()}`)).id;

    await users.create({
      organizationId: orgA,
      email: 'owner@metrics.test',
      password,
      name: 'Owner',
      role: UserRole.Owner,
    });
    await users.create({
      organizationId: orgA,
      email: 'agent@metrics.test',
      password,
      name: 'Agent',
      role: UserRole.Agent,
    });

    ownerToken = (
      await api().post('/api/v1/auth/login').send({ email: 'owner@metrics.test', password })
    ).body.data.accessToken;
    agentToken = (
      await api().post('/api/v1/auth/login').send({ email: 'agent@metrics.test', password })
    ).body.data.accessToken;

    const customerA = (
      await dataSource.query(
        `INSERT INTO customers (organization_id, name) VALUES ($1,'A') RETURNING id`,
        [orgA],
      )
    )[0].id;
    const customerB = (
      await dataSource.query(
        `INSERT INTO customers (organization_id, name) VALUES ($1,'B') RETURNING id`,
        [orgB],
      )
    )[0].id;

    // Org A: 4 conversations — 2 closed (1 AI-resolved), 2 open (1 handed off).
    await seedConversation({
      organizationId: orgA,
      customerId: customerA,
      status: 'CLOSED',
      mode: 'AI',
      minutesAgo: 60,
      closedAfterSeconds: 600,
      // Customer at +0, AI at +10 → a 10s first response.
      messages: [
        ['CUSTOMER', 0],
        ['AI', 10],
      ],
    });
    await seedConversation({
      organizationId: orgA,
      customerId: customerA,
      status: 'CLOSED',
      mode: 'HUMAN',
      handoffReason: 'AI_CANNOT_ANSWER',
      minutesAgo: 50,
      closedAfterSeconds: 1200,
      // Customer at +0, ADMIN at +20 → a 20s first response.
      messages: [
        ['CUSTOMER', 0],
        ['ADMIN', 20],
      ],
    });
    await seedConversation({
      organizationId: orgA,
      customerId: customerA,
      status: 'OPEN',
      mode: 'AI',
      minutesAgo: 40,
    });
    await seedConversation({
      organizationId: orgA,
      customerId: customerA,
      status: 'OPEN',
      mode: 'HUMAN',
      handoffReason: 'CUSTOMER_REQUESTED',
      minutesAgo: 30,
    });

    // Org B: a closed, AI-resolved conversation that must never reach org A.
    await seedConversation({
      organizationId: orgB,
      customerId: customerB,
      status: 'CLOSED',
      mode: 'AI',
      minutesAgo: 20,
      closedAfterSeconds: 60,
      messages: [
        ['CUSTOMER', 0],
        ['AI', 1],
      ],
    });

    await dataSource.query(
      `INSERT INTO ai_usage_logs
         (organization_id, purpose, provider, model, input_tokens, output_tokens, total_tokens,
          estimated_cost_usd, latency_ms, success)
       VALUES ($1,'chat','stub','stub-model',100,50,150,0.01,200,true),
              ($1,'chat','stub','stub-model',200,100,300,0.02,400,true),
              ($2,'chat','stub','stub-model',999,999,1998,9.99,100,true)`,
      [orgA, orgB],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('permissions', () => {
    it('lets an AGENT read operational metrics', async () => {
      await api()
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(200);
    });

    it('refuses an AGENT the cost report', async () => {
      // AGENT has conversation.read but not settings.read: inbox staff see
      // their own workload, not what the organization spends.
      await api()
        .get('/api/v1/admin/analytics/ai-usage')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);
    });

    it('lets an OWNER read the cost report', async () => {
      await api()
        .get('/api/v1/admin/analytics/ai-usage')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });

    it('rejects an unauthenticated request', async () => {
      await api().get('/api/v1/admin/analytics/overview').expect(401);
    });
  });

  describe('overview', () => {
    it('counts only the caller organization conversations', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/overview')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // Org B contributed a 5th conversation; it must not appear here.
      expect(body.conversations.total).toBe(4);
      expect(body.conversations.closed).toBe(2);
      expect(body.conversations.handedOff).toBe(2);
    });

    it('measures AI resolution over closed conversations only', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/overview')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // 2 closed, 1 of them without a handoff. The two still-open
      // conversations are excluded: nothing has resolved them yet, and
      // counting them would inflate the rate simply because the inbox is
      // busy. Handoff, by contrast, is an event over all 4.
      expect(body.conversations.aiResolved).toBe(1);
      expect(body.rates.aiResolutionSampled).toBe(2);
      expect(body.rates.aiResolution).toBeCloseTo(0.5);
      expect(body.rates.handoff).toBeCloseTo(0.5);
    });

    it('averages first response time from customer message to the next reply', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/overview')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // 10s (AI) and 20s (ADMIN) → mean 15. Org B's 1s reply is excluded.
      expect(body.responseTime.sampled).toBe(2);
      expect(body.responseTime.averageSeconds).toBeCloseTo(15);
    });

    it('reports conversation duration with its sample size', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/overview')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // 600s and 1200s → 900s mean, over the 2 closed conversations only.
      expect(body.conversationDuration.sampled).toBe(2);
      expect(body.conversationDuration.averageSeconds).toBeCloseTo(900);
    });

    it('returns null rather than zero when a window holds no conversations', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/overview')
          .query({ from: '2020-01-01T00:00:00.000Z', to: '2020-01-02T00:00:00.000Z' })
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // 0% would read as "the AI resolves nothing"; null reads as "no data".
      expect(body.conversations.total).toBe(0);
      expect(body.rates.aiResolution).toBeNull();
      expect(body.rates.handoff).toBeNull();
    });

    it('breaks down handoff reasons', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/overview')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      const reasons = Object.fromEntries(
        body.handoffReasons.map((r: { reason: string; count: number }) => [r.reason, r.count]),
      );
      expect(reasons).toEqual({ AI_CANNOT_ANSWER: 1, CUSTOMER_REQUESTED: 1 });
    });
  });

  describe('ai-usage', () => {
    it('totals only the caller organization usage', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/ai-usage')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // Org B's row carries 1998 tokens and $9.99 — if the tenant filter
      // slipped, these assertions are what notices.
      expect(body.totals.requests).toBe(2);
      expect(body.totals.totalTokens).toBe(450);
      expect(body.totals.inputTokens).toBe(300);
      expect(body.totals.estimatedCostUsd).toBeCloseTo(0.03);
    });

    it('includes the current day in the daily series', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/ai-usage')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // `to` is an exclusive timestamp, so the series bound must be derived
      // from the timestamp, not from `to::date - 1 day` — otherwise today's
      // traffic lands in `totals` but vanishes from the chart beside it.
      const today = new Date().toISOString().slice(0, 10);
      const last = body.daily.at(-1);
      expect(last.date).toBe(today);
      expect(last.requests).toBe(2);

      const charted = body.daily.reduce(
        (sum: number, d: { requests: number }) => sum + d.requests,
        0,
      );
      expect(charted).toBe(body.totals.requests);
    });

    it('leaves quiet days in the series as zero', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/ai-usage')
          .query({ days: 7 })
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      // Exactly 7 buckets, not 8: the window snaps to midnight so "last 7
      // days" does not straddle an 8th calendar day. A gap would read as
      // missing data rather than a quiet day, so every day is present.
      expect(body.daily).toHaveLength(7);
      expect(body.daily.at(-1).date).toBe(new Date().toISOString().slice(0, 10));
      expect(body.daily.every((d: { requests: number }) => typeof d.requests === 'number')).toBe(
        true,
      );
    });

    it('groups usage by model', async () => {
      const body = (
        await api()
          .get('/api/v1/admin/analytics/ai-usage')
          .set('Authorization', `Bearer ${ownerToken}`)
          .expect(200)
      ).body.data;

      expect(body.byModel).toEqual([
        expect.objectContaining({ model: 'stub-model', provider: 'stub', requests: 2 }),
      ]);
    });

    it('rejects an out-of-range window', async () => {
      await api()
        .get('/api/v1/admin/analytics/ai-usage')
        .query({ days: 9999 })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(400);
    });
  });
});
