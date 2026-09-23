import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { UsersService } from '@/modules/users/users.service';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { CustomerEntity, ConversationEntity } from '@/models/entities';
import { UserRole } from '@/shared/constants';

/**
 * Phase 2 acceptance (master plan §47):
 *   Customer → Message → Admin Inbox → Admin Reply → Customer, in real time.
 *
 * Exercised against a real Postgres, a real Redis-backed Socket.IO server and
 * real socket clients — mocking the transport here would test the mock.
 */
describe('Chat, inbox and realtime (e2e)', () => {
  jest.setTimeout(45_000);

  let app: INestApplication;
  let dataSource: DataSource;
  let baseUrl: string;

  const password = 'Password123!';
  let orgSlug: string;
  let adminToken: string;
  let sessionToken: string;
  let conversationId: string;
  let otherOrgConversationId: string;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const connect = (namespace: string, token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}${namespace}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    // A real listener: socket clients need a port to dial.
    await app.listen(0);
    baseUrl = await app.getUrl().then((url) => url.replace('[::1]', 'localhost'));

    dataSource = app.get(DataSource);
    await dataSource.query(
      'TRUNCATE message_attachments, messages, conversations, customer_sessions, customers, refresh_tokens, users, organizations CASCADE',
    );

    const organizations = app.get(OrganizationsService);
    const users = app.get(UsersService);

    orgSlug = `acme-${Date.now()}`;
    const org = await organizations.create('Acme', orgSlug);
    const otherOrg = await organizations.create('Globex', `globex-${Date.now()}`);

    await users.create({
      organizationId: org.id,
      email: 'owner@acme.test',
      password,
      name: 'Acme Owner',
      role: UserRole.Owner,
    });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@acme.test', password })
      .expect(200);
    adminToken = login.body.data.accessToken;

    // A conversation belonging to a different tenant, for isolation checks.
    const customers = dataSource.getRepository(CustomerEntity);
    const conversations = dataSource.getRepository(ConversationEntity);
    const otherCustomer = await customers.save(
      customers.create({ organizationId: otherOrg.id, name: 'Globex Cust', metadata: {}, tags: [] }),
    );
    const otherConversation = await conversations.save(
      conversations.create({ organizationId: otherOrg.id, customerId: otherCustomer.id }),
    );
    otherOrgConversationId = otherConversation.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('customer session', () => {
    it('creates a customer, a conversation and an httpOnly cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .send({ organizationSlug: orgSlug, name: 'คุณลูกค้า' })
        .expect(201);

      sessionToken = response.body.data.sessionToken;
      conversationId = response.body.data.conversation.id;

      expect(sessionToken).toEqual(expect.any(String));
      expect(response.body.data.conversation.status).toBe('OPEN');

      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies.join(';')).toContain('HttpOnly');
    });

    it('resumes the same conversation rather than orphaning a thread', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ organizationSlug: orgSlug })
        .expect(201);

      expect(response.body.data.conversation.id).toBe(conversationId);
    });

    it('rejects an unknown session token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/chat/conversation')
        .set('Authorization', 'Bearer not-a-real-session')
        .expect(401);
    });
  });

  describe('Customer → Admin Inbox → Admin Reply → Customer', () => {
    let adminSocket: Socket;
    let customerSocket: Socket;
    const adminMessages: Record<string, unknown>[] = [];
    const customerMessages: Record<string, unknown>[] = [];
    const customerConversationUpdates: Record<string, unknown>[] = [];

    beforeAll(async () => {
      adminSocket = await connect('/ws/admin', adminToken);
      customerSocket = await connect('/ws/customer', sessionToken);

      adminSocket.on('message:new', (m) => adminMessages.push(m));
      customerSocket.on('message:new', (m) => customerMessages.push(m));
      customerSocket.on('conversation:updated', (c) => customerConversationUpdates.push(c));

      await adminSocket.emitWithAck('conversation:subscribe', { conversationId });
    });

    afterAll(() => {
      adminSocket?.close();
      customerSocket?.close();
    });

    it('delivers a customer message to the admin in real time', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'สวัสดีครับ' })
        .expect(201);

      await wait(400);
      expect(adminMessages.some((m) => m.content === 'สวัสดีครับ')).toBe(true);
    });

    it('shows the conversation in the admin inbox with an unread badge', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/conversations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const item = response.body.data.find(
        (c: { id: string }) => c.id === conversationId,
      );

      expect(item).toBeDefined();
      expect(item.unreadCount).toBeGreaterThan(0);
      expect(item.lastMessage.content).toBe('สวัสดีครับ');
    });

    it('delivers an admin reply to the customer in real time', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'ยินดีให้บริการครับ' })
        .expect(201);

      await wait(400);
      const received = customerMessages.find((m) => m.content === 'ยินดีให้บริการครับ');

      expect(received).toBeDefined();
      // The customer sees a display name, never the admin's id or email.
      expect(received?.senderName).toBe('Acme Owner');
      expect(received).not.toHaveProperty('senderId');
    });

    it('flips the conversation to HUMAN when an admin replies', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.mode).toBe('HUMAN');
      expect(response.body.data.assignedUser?.name).toBe('Acme Owner');
    });

    it('never sends the admin projection to the customer namespace', async () => {
      // conversation:updated fans out to both namespaces with *different*
      // payloads; the customer one must not carry admin-only fields.
      expect(customerConversationUpdates.length).toBeGreaterThan(0);

      for (const update of customerConversationUpdates) {
        expect(update).not.toHaveProperty('handoffReason');
        expect(update).not.toHaveProperty('assignedUser');
        expect(update).not.toHaveProperty('customer');
      }
    });

    it('relays typing in both directions', async () => {
      const adminSawTyping: unknown[] = [];
      const customerSawTyping: unknown[] = [];
      adminSocket.on('typing:start', (t) => adminSawTyping.push(t));
      customerSocket.on('typing:start', (t) => customerSawTyping.push(t));

      customerSocket.emit('typing:start', {});
      adminSocket.emit('typing:start', { conversationId });
      await wait(400);

      expect(adminSawTyping.length).toBeGreaterThan(0);
      expect(customerSawTyping.length).toBeGreaterThan(0);
    });

    it('clears the unread badge when the admin reads', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${conversationId}/read`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/conversations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        response.body.data.find((c: { id: string }) => c.id === conversationId).unreadCount,
      ).toBe(0);
    });

    it('does not involve the AI at all (no agent configured for this org)', async () => {
      // Phase 2's assertions assume a human-only thread. The AI worker is
      // live in this process from Phase 3 on, so state that this org has no
      // agent explicitly — otherwise an unexpected AI reply could make these
      // tests pass for the wrong reason.
      const aiMessages = await dataSource.query(
        `SELECT count(*)::int AS count FROM messages WHERE conversation_id = $1 AND sender_type = 'AI'`,
        [conversationId],
      );

      expect(aiMessages[0].count).toBe(0);
    });

    it('returns the transcript oldest-first', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const contents = response.body.data.map((m: { content: string }) => m.content);
      expect(contents[0]).toBe('สวัสดีครับ');
      expect(contents.at(-1)).toBe('ยินดีให้บริการครับ');
    });
  });

  describe('closed conversations', () => {
    it('keeps serving the customer widget after an admin closes the thread', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${conversationId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(201);

      // Excluding CLOSED here previously 404'd, which killed the customer's
      // open widget the moment an admin marked the thread resolved.
      const conversation = await request(app.getHttpServer())
        .get('/api/v1/chat/conversation')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(conversation.body.data.status).toBe('CLOSED');

      await request(app.getHttpServer())
        .get('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);
    });

    it('reopens the conversation when the customer sends again', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ content: 'ขอถามเพิ่มครับ' })
        .expect(201);

      const conversation = await request(app.getHttpServer())
        .get('/api/v1/chat/conversation')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      expect(conversation.body.data.status).toBe('OPEN');
    });

    it('starts a NEW conversation for a returning visitor (TD-09)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${conversationId}/close`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(201);

      // A closed thread is resolved; a fresh visit gets a fresh thread rather
      // than appending a new issue to a finished one.
      const session = await request(app.getHttpServer())
        .post('/api/v1/chat/sessions')
        .set('Authorization', `Bearer ${sessionToken}`)
        .send({ organizationSlug: orgSlug })
        .expect(201);

      expect(session.body.data.conversation.id).not.toBe(conversationId);
      expect(session.body.data.conversation.status).toBe('OPEN');
    });
  });

  describe('tenant isolation on the realtime surface', () => {
    it('refuses to subscribe an admin to another org conversation', async () => {
      const socket = await connect('/ws/admin', adminToken);
      const ack = await socket.emitWithAck('conversation:subscribe', {
        conversationId: otherOrgConversationId,
      });

      expect(ack.ok).toBe(false);
      socket.close();
    });

    it('rejects an invalid token at the handshake', async () => {
      await expect(connect('/ws/admin', 'not-a-jwt')).rejects.toBeDefined();
      await expect(connect('/ws/customer', 'not-a-session')).rejects.toBeDefined();
    });

    it('returns 404 for another org conversation over REST', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/admin/conversations/${otherOrgConversationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(`/api/v1/admin/conversations/${otherOrgConversationId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'should never land' })
        .expect(404);
    });
  });
});
