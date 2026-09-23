import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 003 — customers and anonymous chat sessions (docs/DATABASE.md §3.1). */
export class Customers1758000003000 implements MigrationInterface {
  name = 'Customers1758000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "customers" (
        "id"              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid         NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name"            varchar(200),
        "email"           citext,
        "phone"           varchar(32),
        "avatar_url"      text,
        "metadata"        jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "tags"            text[]       NOT NULL DEFAULT '{}'::text[],
        "notes"           text,
        "created_at"      timestamptz  NOT NULL DEFAULT now(),
        "updated_at"      timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_customers_org" ON "customers" ("organization_id")`);
    // Not unique: the same person may open several conversations before
    // identifying themselves. Deduplicating customers is a product decision,
    // not a constraint (docs/DATABASE.md §3.1).
    await queryRunner.query(
      `CREATE INDEX "ix_customers_org_email" ON "customers" ("organization_id", "email") WHERE "email" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "customer_sessions" (
        "id"              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid         NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "customer_id"     uuid         NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
        "token_hash"      varchar(255) NOT NULL,
        "expires_at"      timestamptz  NOT NULL,
        "last_seen_at"    timestamptz,
        "revoked_at"      timestamptz,
        "user_agent"      text,
        "ip"              inet,
        "created_at"      timestamptz  NOT NULL DEFAULT now(),
        "updated_at"      timestamptz  NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_customer_sessions_hash" ON "customer_sessions" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_customer_sessions_customer" ON "customer_sessions" ("customer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_customer_sessions_org" ON "customer_sessions" ("organization_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_sessions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customers"`);
  }
}
