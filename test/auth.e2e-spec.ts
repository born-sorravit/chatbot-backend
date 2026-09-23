import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '@/app.module';
import { UsersService } from '@/modules/users/users.service';
import { OrganizationsService } from '@/modules/organizations/organizations.service';
import { CustomerEntity } from '@/models/entities';
import { UserRole } from '@/shared/constants';

/**
 * Phase 1 acceptance criteria, exercised against a real database:
 *   - admin login / logout
 *   - RBAC allows and denies
 *   - organization isolation
 *
 * Two organizations are seeded so every isolation assertion has a real
 * neighbour to fail against, rather than proving nothing on empty data.
 */
describe('Auth, RBAC and tenant isolation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  const password = 'Password123!';
  let orgAId: string;
  let orgACustomerId: string;
  let orgBCustomerId: string;
  let ownerToken: string;
  let agentToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    dataSource = app.get(DataSource);
    const users = app.get(UsersService);
    const organizations = app.get(OrganizationsService);

    // Clean slate — these tables are e2e-owned in the test database.
    await dataSource.query(
      'TRUNCATE customer_sessions, customers, refresh_tokens, users, organizations CASCADE',
    );

    const orgA = await organizations.create('Org A', `org-a-${Date.now()}`);
    const orgB = await organizations.create('Org B', `org-b-${Date.now()}`);
    orgAId = orgA.id;

    await users.create({
      organizationId: orgA.id,
      email: 'owner@org-a.test',
      password,
      name: 'Org A Owner',
      role: UserRole.Owner,
    });
    await users.create({
      organizationId: orgA.id,
      email: 'agent@org-a.test',
      password,
      name: 'Org A Agent',
      role: UserRole.Agent,
    });

    const customers = dataSource.getRepository(CustomerEntity);
    const [customerA, customerB] = await customers.save([
      customers.create({ organizationId: orgA.id, name: 'Org A Customer', metadata: {}, tags: [] }),
      customers.create({ organizationId: orgB.id, name: 'Org B Customer', metadata: {}, tags: [] }),
    ]);
    orgACustomerId = customerA.id;
    orgBCustomerId = customerB.id;

    const login = async (email: string) => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);
      return response.body.data.accessToken as string;
    };

    ownerToken = await login('owner@org-a.test');
    agentToken = await login('agent@org-a.test');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('login', () => {
    it('returns tokens and the effective permission set', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@org-a.test', password })
        .expect(200);

      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(response.body.data.refreshToken).toEqual(expect.any(String));
      expect(response.body.data.user.organizationId).toBe(orgAId);
      expect(response.body.data.user.permissions).toContain('user.write');
    });

    it('never reveals whether an email exists', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@org-a.test', password: 'WrongPassword1' })
        .expect(401);

      const unknownEmail = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ghost@org-a.test', password: 'WrongPassword1' })
        .expect(401);

      expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknownEmail.body.error.code).toBe(wrongPassword.body.error.code);
      expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
    });

    it('takes comparable time for an unknown email as for a wrong password', async () => {
      // The unknown-email path runs a dummy argon2 verify so it cannot be
      // distinguished by response time. Without it, "no such user" returns in
      // microseconds while "wrong password" pays the full KDF cost — a
      // user-enumeration oracle that asserting on status codes cannot catch.
      const measure = async (email: string) => {
        const samples: number[] = [];
        for (let i = 0; i < 5; i += 1) {
          const started = performance.now();
          await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email, password: 'WrongPassword1' })
            .expect(401);
          samples.push(performance.now() - started);
        }
        return samples.sort((a, b) => a - b)[2]; // median
      };

      const known = await measure('owner@org-a.test');
      const unknown = await measure('ghost@org-a.test');

      // Generous bound — this catches "one path skips the KDF entirely"
      // (an order of magnitude), not small scheduling noise.
      const ratio = Math.max(known, unknown) / Math.min(known, unknown);
      expect(ratio).toBeLessThan(3);
    });

    it('rejects unknown fields rather than silently ignoring them', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@org-a.test', password, role: 'OWNER' })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('refresh token rotation', () => {
    it('rotates on use and burns the family when a revoked token is replayed', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@org-a.test', password })
        .expect(200);

      const first = login.body.data.refreshToken as string;

      const rotated = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: first })
        .expect(200);

      const second = rotated.body.data.refreshToken as string;
      expect(second).not.toBe(first);

      // Replaying the consumed token signals theft.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: first })
        .expect(401);

      // ...so its descendant must be dead too, not just the replayed token.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: second })
        .expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the session so the refresh token stops working', async () => {
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@org-a.test', password })
        .expect(200);

      const { accessToken, refreshToken } = login.body.data;

      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('validates the logout body instead of 500-ing on a bad type', async () => {
      // Previously typed as Partial<RefreshDto>; a mapped type erases to
      // Object in design:type metadata, so ValidationPipe had nothing to
      // validate and a numeric token reached createHash().
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'owner@org-a.test', password })
        .expect(200);

      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${login.body.data.accessToken}`)
        .send({ refreshToken: 12345 })
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('RBAC', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/admin/users').expect(401);
    });

    it('allows OWNER to read users', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it('denies AGENT the user.read permission with 403', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);

      expect(response.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('denies AGENT the user.write permission with 403', async () => {
      await request(app.getHttpServer())
        .post('/admin/users')
        .set('Authorization', `Bearer ${agentToken}`)
        .send({ email: 'new@org-a.test', password, name: 'New' })
        .expect(403);
    });

    it('still allows AGENT the conversation work the inbox needs', async () => {
      await request(app.getHttpServer())
        .get('/admin/customers')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(200);
    });

    it('attaches a requestId to guard-level failures', async () => {
      // Guards run before interceptors, so this only holds because the
      // request id is assigned in middleware.
      const response = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Authorization', `Bearer ${agentToken}`)
        .expect(403);

      expect(response.body.error.requestId).toEqual(expect.any(String));
      expect(response.body.error.requestId).not.toBe('unknown');
    });
  });

  describe('organization isolation', () => {
    it('reads its own customer', async () => {
      const response = await request(app.getHttpServer())
        .get(`/admin/customers/${orgACustomerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.data.id).toBe(orgACustomerId);
    });

    it("returns 404 — not 403 — for another organization's customer", async () => {
      // 403 would confirm the row exists, which is itself a leak.
      const response = await request(app.getHttpServer())
        .get(`/admin/customers/${orgBCustomerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);

      expect(response.body.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it("cannot write to another organization's customer", async () => {
      await request(app.getHttpServer())
        .patch(`/admin/customers/${orgBCustomerId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ notes: 'should never land' })
        .expect(404);

      const untouched = await dataSource
        .getRepository(CustomerEntity)
        .findOne({ where: { id: orgBCustomerId } });

      expect(untouched?.notes).toBeNull();
    });

    it("never lists another organization's customers", async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/customers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const ids = response.body.data.map((customer: { id: string }) => customer.id);
      expect(ids).toContain(orgACustomerId);
      expect(ids).not.toContain(orgBCustomerId);
    });

    it('cannot reach another organization through a search term', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/customers')
        .query({ search: 'Org B Customer' })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(response.body.meta.total).toBe(0);
    });
  });
});
