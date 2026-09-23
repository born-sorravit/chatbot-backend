import 'reflect-metadata';
import * as argon2 from 'argon2';
import dataSource from '@/shared/database/typeorm.config';
import {
  AiAgentEntity,
  AiAgentToolEntity,
  AiToolEntity,
  CustomerEntity,
  OrderEntity,
  OrganizationEntity,
  ProductEntity,
  UserEntity,
} from '@/models/entities';
import { OrderStatus, UserRole } from '@/shared/constants';
import { z } from 'zod';
import { DEFAULT_SYSTEM_PROMPT } from '@/modules/ai/prompts/prompt.service';

const SEED_ORG_SLUG = 'acme';

/**
 * Development seed (docs/DATABASE.md §6).
 *
 * Idempotent — re-running it updates nothing and creates nothing twice, so it
 * is safe to call after every migration during development.
 */
async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  await dataSource.initialize();

  try {
    const organizations = dataSource.getRepository(OrganizationEntity);
    const users = dataSource.getRepository(UserEntity);
    const customers = dataSource.getRepository(CustomerEntity);

    let organization = await organizations.findOne({ where: { slug: SEED_ORG_SLUG } });

    if (!organization) {
      organization = await organizations.save(
        organizations.create({ name: 'Acme Co.', slug: SEED_ORG_SLUG, settings: {} }),
      );
      console.log(`✓ organization created: ${organization.slug} (${organization.id})`);
    } else {
      console.log(`· organization exists: ${organization.slug}`);
    }

    const seedUsers = [
      { email: 'owner@acme.com', name: 'Acme Owner', role: UserRole.Owner, password: 'Password123!' },
      { email: 'agent@acme.com', name: 'Acme Agent', role: UserRole.Agent, password: 'Password123!' },
    ];

    for (const candidate of seedUsers) {
      const existing = await users.findOne({
        where: { organizationId: organization.id, email: candidate.email },
      });

      if (existing) {
        console.log(`· user exists: ${candidate.email}`);
        continue;
      }

      await users.save(
        users.create({
          organizationId: organization.id,
          email: candidate.email,
          name: candidate.name,
          role: candidate.role,
          permissions: [],
          isActive: true,
          passwordHash: await argon2.hash(candidate.password, {
            type: argon2.argon2id,
            memoryCost: 19456,
            timeCost: 2,
            parallelism: 1,
          }),
        }),
      );
      console.log(`✓ user created: ${candidate.email} (${candidate.role})`);
    }

    const customerCount = await customers.count({ where: { organizationId: organization.id } });

    if (customerCount === 0) {
      await customers.save([
        customers.create({
          organizationId: organization.id,
          name: 'สมชาย ใจดี',
          email: 'somchai@example.com',
          phone: '0812345678',
          metadata: {},
          tags: ['vip'],
        }),
        customers.create({
          organizationId: organization.id,
          name: 'Jane Doe',
          email: 'jane@example.com',
          metadata: {},
          tags: [],
        }),
      ]);
      console.log('✓ customers created: 2');
    } else {
      console.log(`· customers exist: ${customerCount}`);
    }

    const agents = dataSource.getRepository(AiAgentEntity);
    const existingAgent = await agents.findOne({
      where: { organizationId: organization.id, isDefault: true },
    });

    if (!existingAgent) {
      await agents.save(
        agents.create({
          organizationId: organization.id,
          name: 'Customer Support AI',
          description: 'Handles product, order and policy questions',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          language: 'th',
          tone: 'friendly',
          isDefault: true,
          isActive: true,
        }),
      );
      console.log('✓ AI agent created: Customer Support AI (default)');
    } else {
      console.log('· AI agent exists: ' + existingAgent.name);
    }

    /* ── Phase 6: business fixtures backing the tools (TD-08) ─────────── */
    const products = dataSource.getRepository(ProductEntity);
    const orders = dataSource.getRepository(OrderEntity);

    if ((await products.count({ where: { organizationId: organization.id } })) === 0) {
      await products.save([
        products.create({
          organizationId: organization.id,
          sku: 'IP17P-BLK-256',
          name: 'iPhone 17 Pro',
          description: 'iPhone 17 Pro 256GB',
          priceCents: '4290000',
          stockQuantity: 5,
          attributes: { color: 'black', storage: '256GB' },
        }),
        products.create({
          organizationId: organization.id,
          sku: 'IP17P-WHT-256',
          name: 'iPhone 17 Pro',
          description: 'iPhone 17 Pro 256GB',
          priceCents: '4290000',
          stockQuantity: 0,
          attributes: { color: 'white', storage: '256GB' },
        }),
        products.create({
          organizationId: organization.id,
          sku: 'APP-USB-C',
          name: 'สายชาร์จ USB-C',
          description: 'สายชาร์จ USB-C ยาว 1 เมตร',
          priceCents: '59000',
          stockQuantity: 120,
          attributes: { length: '1m' },
        }),
      ]);
      console.log('✓ products created: 3');
    } else {
      console.log('· products exist');
    }

    if ((await orders.count({ where: { organizationId: organization.id } })) === 0) {
      const firstCustomer = await customers.findOne({
        where: { organizationId: organization.id },
      });

      await orders.save([
        orders.create({
          organizationId: organization.id,
          customerId: firstCustomer?.id ?? null,
          orderNumber: '1234',
          status: OrderStatus.Shipped,
          totalCents: '4290000',
          trackingNumber: 'TH123456789',
          shippedAt: new Date(),
        }),
        orders.create({
          organizationId: organization.id,
          // Deliberately unowned, so an order-ownership test has a row that
          // any customer may read.
          customerId: null,
          orderNumber: '5678',
          status: OrderStatus.Processing,
          totalCents: '59000',
        }),
      ]);
      console.log('✓ orders created: 2');
    } else {
      console.log('· orders exist');
    }

    /* ── Tool registry rows + allowlist ───────────────────────────────── */
    const toolRepo = dataSource.getRepository(AiToolEntity);
    const agentToolRepo = dataSource.getRepository(AiAgentToolEntity);

    const TOOL_SEED = [
      {
        name: 'getProduct',
        description:
          'Look up a product by name or SKU. Returns its price, currency and attributes. ' +
          'Use this whenever a customer asks about a specific product — never state a price from memory.',
        schema: z.object({ query: z.string().min(1).max(200) }),
      },
      {
        name: 'getProductStock',
        description:
          'Check live stock for a product, optionally for a specific variant (colour, size). ' +
          'Always use this before telling a customer whether something is in stock.',
        schema: z.object({ query: z.string().min(1).max(200), variant: z.string().max(100).optional() }),
      },
      {
        name: 'getOrderStatus',
        description:
          'Look up the status and tracking number of an order by its order number. ' +
          'Never guess or infer an order status — always call this.',
        schema: z.object({ orderId: z.string().min(1).max(64) }),
      },
    ];

    const defaultAgent = await agents.findOne({
      where: { organizationId: organization.id, isDefault: true },
    });

    for (const seed of TOOL_SEED) {
      let tool = await toolRepo.findOne({
        where: { organizationId: organization.id, name: seed.name },
      });

      if (!tool) {
        tool = await toolRepo.save(
          toolRepo.create({
            organizationId: organization.id,
            name: seed.name,
            description: seed.description,
            inputSchema: z.toJSONSchema(seed.schema) as Record<string, unknown>,
            mutating: false,
            isActive: true,
          }),
        );
        console.log(`✓ tool registered: ${seed.name}`);
      }

      if (defaultAgent) {
        const linked = await agentToolRepo.findOne({
          where: { aiAgentId: defaultAgent.id, aiToolId: tool.id },
        });
        if (!linked) {
          await agentToolRepo.save(
            agentToolRepo.create({
              aiAgentId: defaultAgent.id,
              aiToolId: tool.id,
              organizationId: organization.id,
              enabled: true,
            }),
          );
        }
      }
    }

    console.log('\nSeed complete. Login with owner@acme.com / Password123!');
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
