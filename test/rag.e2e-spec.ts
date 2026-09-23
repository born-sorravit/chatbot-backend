import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { UsersService } from '../src/users/users.service';
import { OrganizationsService } from '../src/organizations/organizations.service';
import { AiAgentEntity, MessageEntity } from '../src/database/entities';
import { DEFAULT_SYSTEM_PROMPT } from '../src/ai/prompts/prompt.service';
import { ConversationMode, MessageSenderType, UserRole } from '../src/common/constants';

/**
 * Phase 4 acceptance (master plan §47):
 *   an admin adds business information and the AI answers from it.
 *
 * Runs against real Postgres with pgvector — the HNSW index, the cosine
 * search and the distance threshold are all the production path. Only the
 * embedding function is the offline lexical provider.
 */
describe('Knowledge base and RAG (e2e)', () => {
  jest.setTimeout(90_000);

  let app: INestApplication;
  let dataSource: DataSource;

  const password = 'Password123!';
  let orgSlug: string;
  let adminToken: string;
  let agentId: string;
  let knowledgeBaseId: string;
  let refundDocId: string;

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForStatus(documentId: string, status: string, timeoutMs = 25_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const rows = await dataSource.query(
        'SELECT status, chunk_count, error_message FROM knowledge_documents WHERE id = $1',
        [documentId],
      );
      if (rows[0]?.status === status) return rows[0];
      await wait(300);
    }
    const rows = await dataSource.query(
      'SELECT status, error_message FROM knowledge_documents WHERE id = $1',
      [documentId],
    );
    throw new Error(
      `Document never reached ${status}; last=${rows[0]?.status} err=${rows[0]?.error_message}`,
    );
  }

  async function addDocument(title: string, content: string, sourceType = 'TEXT') {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/knowledge-bases/${knowledgeBaseId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title, sourceType, content })
      .expect(201);
    return response.body.data.id as string;
  }

  async function startChat(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/chat/sessions')
      .send({ organizationSlug: orgSlug, name: 'RAG Customer' })
      .expect(201);
    return response.body.data.sessionToken;
  }

  async function conversationIdFor(sessionToken: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/chat/conversation')
      .set('Authorization', `Bearer ${sessionToken}`)
      .expect(200);
    return response.body.data.id;
  }

  async function ask(sessionToken: string, content: string): Promise<MessageEntity> {
    await request(app.getHttpServer())
      .post('/api/v1/chat/messages')
      .set('Authorization', `Bearer ${sessionToken}`)
      .send({ content })
      .expect(201);

    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const messages = await request(app.getHttpServer())
        .get('/api/v1/chat/messages')
        .set('Authorization', `Bearer ${sessionToken}`)
        .expect(200);

      const ai = messages.body.data.filter(
        (m: { senderType: string }) => m.senderType === MessageSenderType.Ai,
      );
      if (ai.length > 0) return ai.at(-1);
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
      'TRUNCATE knowledge_chunks, ai_agent_knowledge_bases, knowledge_documents, knowledge_bases, ai_usage_logs, messages, conversations, customer_sessions, customers, ai_agents, refresh_tokens, users, organizations CASCADE',
    );

    const organizations = app.get(OrganizationsService);
    const users = app.get(UsersService);

    orgSlug = `rag-acme-${Date.now()}`;
    const org = await organizations.create('RAG Acme', orgSlug);

    await users.create({
      organizationId: org.id,
      email: 'owner@rag-acme.test',
      password,
      name: 'RAG Owner',
      role: UserRole.Owner,
    });

    const agents = dataSource.getRepository(AiAgentEntity);
    agentId = (
      await agents.save(
        agents.create({
          organizationId: org.id,
          name: 'RAG Support AI',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          isDefault: true,
          isActive: true,
          ragEnabled: true,
        }),
      )
    ).id;

    adminToken = (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@rag-acme.test', password })
        .expect(200)
    ).body.data.accessToken;

    const kb = await request(app.getHttpServer())
      .post('/api/v1/admin/knowledge-bases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'นโยบายบริษัท' })
      .expect(201);
    knowledgeBaseId = kb.body.data.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('ingestion', () => {
    it('indexes a plain-text document into chunks', async () => {
      refundDocId = await addDocument(
        'นโยบายการคืนสินค้า',
        'ลูกค้าสามารถขอคืนสินค้าได้ภายใน 7 วัน นับจากวันที่ได้รับสินค้า โดยสินค้าต้องอยู่ในสภาพสมบูรณ์ ไม่ผ่านการใช้งาน บริษัทจะคืนเงินภายใน 14 วันทำการ',
      );

      const row = await waitForStatus(refundDocId, 'READY');
      expect(row.chunk_count).toBeGreaterThan(0);
    });

    it('writes real vectors of the schema width', async () => {
      const rows = await dataSource.query(
        'SELECT vector_dims(embedding) AS dims FROM knowledge_chunks WHERE document_id = $1 LIMIT 1',
        [refundDocId],
      );
      expect(Number(rows[0].dims)).toBe(1024);
    });

    it('indexes an FAQ document, keeping Q/A pairs together', async () => {
      const id = await addDocument(
        'การรับประกันสินค้า',
        'Q: รับประกันกี่ปี\nA: รับประกัน 1 ปีเต็มนับจากวันที่ซื้อ\n\nQ: ครอบคลุมอะไรบ้าง\nA: ครอบคลุมความเสียหายจากการผลิต',
        'FAQ',
      );
      await waitForStatus(id, 'READY');
    });

    it('rejects a URL with no resolvable host shape at validation time', async () => {
      // @IsUrl requires a TLD, which also keeps localhost and bare hostnames
      // out — a document source is server-side fetched, so that restriction
      // is worth having.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-bases/${knowledgeBaseId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'localhost', sourceType: 'URL', sourceUrl: 'https://localhost:9/nope' })
        .expect(400);
    });

    it('marks a document FAILED with a readable reason', async () => {
      // §38: "failed" with no reason is not actionable for an admin.
      const response = await request(app.getHttpServer())
        .post(`/api/v1/admin/knowledge-bases/${knowledgeBaseId}/documents`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'หน้าเว็บที่ไม่มีอยู่',
          sourceType: 'URL',
          sourceUrl: 'https://this-host-does-not-resolve-9f2a1c.example/nope',
        })
        .expect(201);

      const row = await waitForStatus(response.body.data.id, 'FAILED');
      expect(row.error_message).toBeTruthy();
    });

    it('replaces chunks on re-index rather than duplicating them', async () => {
      const before = await dataSource.query(
        'SELECT count(*)::int AS c FROM knowledge_chunks WHERE document_id = $1',
        [refundDocId],
      );

      await request(app.getHttpServer())
        .post(`/api/v1/admin/documents/${refundDocId}/reindex`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      await waitForStatus(refundDocId, 'READY');

      const after = await dataSource.query(
        'SELECT count(*)::int AS c FROM knowledge_chunks WHERE document_id = $1',
        [refundDocId],
      );
      expect(after[0].c).toBe(before[0].c);
    });
  });

  describe('retrieval', () => {
    it('ranks the matching document first and marks it relevant', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/knowledge-bases/${knowledgeBaseId}/search`)
        .query({ q: 'คืนสินค้าได้ภายในกี่วัน', limit: 5 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.chunks[0].documentTitle).toBe('นโยบายการคืนสินค้า');
      expect(response.body.data.chunks[0].relevant).toBe(true);
    });

    it('marks every chunk irrelevant for an unrelated question', async () => {
      // The threshold is what makes §23 enforceable — without it, search
      // always returns its nearest row however unrelated.
      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/knowledge-bases/${knowledgeBaseId}/search`)
        .query({ q: 'ราคาหุ้นวันนี้เท่าไหร่', limit: 5 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(
        response.body.data.chunks.some((c: { relevant: boolean }) => c.relevant),
      ).toBe(false);
    });
  });

  describe('AI answers from the knowledge base', () => {
    beforeAll(async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ knowledgeBaseIds: [knowledgeBaseId] })
        .expect(200);
    });

    it('answers a covered question using the indexed content', async () => {
      const session = await startChat();
      const reply = await ask(session, 'คืนสินค้าได้ภายในกี่วันครับ');

      // The number comes from the document, not from the model's priors.
      expect(reply.content).toContain('7 วัน');
    });

    it('refuses to invent an answer it has no knowledge for, and hands off', async () => {
      // The §23 / §54 guarantee: no fabricated promotions.
      const session = await startChat();
      const reply = await ask(session, 'โปรโมชั่นเดือนหน้ามีอะไรบ้างครับ');

      expect(reply.content).toMatch(/ไม่มีข้อมูล|ส่งต่อ/);

      const conversation = await dataSource.query(
        `SELECT mode, handoff_reason FROM conversations WHERE id = $1`,
        [await conversationIdFor(session)],
      );
      expect(conversation[0].mode).toBe(ConversationMode.Human);
      expect(conversation[0].handoff_reason).toBeTruthy();
    });

    it('does not retrieve when the agent has RAG disabled', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ragEnabled: false })
        .expect(200);

      const result = await request(app.getHttpServer())
        .post(`/api/v1/admin/ai-agents/${agentId}/test`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: 'คืนสินค้าได้ภายในกี่วัน' })
        .expect(200);

      expect(result.body.data.retrieval).toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ragEnabled: true })
        .expect(200);
    });

    it('surfaces retrieval diagnostics in the agent test endpoint', async () => {
      const result = await request(app.getHttpServer())
        .post(`/api/v1/admin/ai-agents/${agentId}/test`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: 'คืนสินค้าได้ภายในกี่วัน' })
        .expect(200);

      // "The AI gave a bad answer" is almost always a retrieval problem
      // rather than a prompt problem; this is what tells them apart.
      expect(result.body.data.retrieval.searched).toBe(true);
      expect(result.body.data.retrieval.chunks.length).toBeGreaterThan(0);
      expect(result.body.data.retrieval.chunks[0].distance).toBeLessThanOrEqual(
        result.body.data.retrieval.maxDistance,
      );
    });
  });

  describe('tenant isolation', () => {
    it('never retrieves another organization\'s chunks', async () => {
      const organizations = app.get(OrganizationsService);
      const other = await organizations.create('Other Co', `other-${Date.now()}`);

      const otherKb = await dataSource.query(
        `INSERT INTO knowledge_bases (organization_id, name) VALUES ($1, $2) RETURNING id`,
        [other.id, 'Other KB'],
      );
      const otherDoc = await dataSource.query(
        `INSERT INTO knowledge_documents (organization_id, knowledge_base_id, title, content, source_type, status)
         VALUES ($1, $2, $3, $4, 'TEXT', 'READY') RETURNING id`,
        [other.id, otherKb[0].id, 'ความลับของบริษัทอื่น', 'ลูกค้าสามารถขอคืนสินค้าได้ภายใน 99 วัน'],
      );
      await dataSource.query(
        `INSERT INTO knowledge_chunks (organization_id, knowledge_base_id, document_id, chunk_index, content, embedding)
         SELECT $1, $2, $3, 0, $4, embedding FROM knowledge_chunks WHERE document_id = $5 LIMIT 1`,
        [other.id, otherKb[0].id, otherDoc[0].id, 'ลูกค้าสามารถขอคืนสินค้าได้ภายใน 99 วัน', refundDocId],
      );

      // Same embedding, so it would rank identically without the tenant
      // predicate — this is precisely the leak R-01 guards against.
      const response = await request(app.getHttpServer())
        .get(`/api/v1/admin/knowledge-bases/${knowledgeBaseId}/search`)
        .query({ q: 'คืนสินค้าได้ภายในกี่วัน', limit: 10 })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const titles = response.body.data.chunks.map(
        (c: { documentTitle: string }) => c.documentTitle,
      );
      expect(titles).not.toContain('ความลับของบริษัทอื่น');
    });

    it('rejects linking an agent to another organization\'s knowledge base', async () => {
      const organizations = app.get(OrganizationsService);
      const other = await organizations.create('Third Co', `third-${Date.now()}`);
      const otherKb = await dataSource.query(
        `INSERT INTO knowledge_bases (organization_id, name) VALUES ($1, $2) RETURNING id`,
        [other.id, 'Third KB'],
      );

      // Without the ownership check this would let an agent read another
      // tenant's knowledge through ordinary chat.
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/ai-agents/${agentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ knowledgeBaseIds: [otherKb[0].id] })
        .expect(404);
    });

    it('returns 404 for another organization\'s knowledge base', async () => {
      const organizations = app.get(OrganizationsService);
      const other = await organizations.create('Fourth Co', `fourth-${Date.now()}`);
      const otherKb = await dataSource.query(
        `INSERT INTO knowledge_bases (organization_id, name) VALUES ($1, $2) RETURNING id`,
        [other.id, 'Fourth KB'],
      );

      await request(app.getHttpServer())
        .get(`/api/v1/admin/knowledge-bases/${otherKb[0].id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('RBAC', () => {
    it('denies an AGENT the knowledge.write permission', async () => {
      const users = app.get(UsersService);
      const org = await dataSource.query(
        'SELECT id FROM organizations WHERE slug = $1',
        [orgSlug],
      );
      await users.create({
        organizationId: org[0].id,
        email: 'agent@rag-acme.test',
        password,
        name: 'RAG Agent',
        role: UserRole.Agent,
      });

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'agent@rag-acme.test', password })
        .expect(200);

      const agentToken = login.body.data.accessToken;

      // AGENT has knowledge.read but not knowledge.write.
      await request(app.getHttpServer())
        .get('/api/v1/admin/knowledge-bases')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/admin/knowledge-bases')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ name: 'ไม่ควรสร้างได้' })
        .expect(403);
    });
  });
});
