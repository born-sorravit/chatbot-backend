import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 011 — product and order tables backing the MVP tools
 * (docs/ARCHITECTURE.md TD-08).
 *
 * A placeholder for a real business system, pending OQ-04. Money is stored in
 * integer minor units throughout.
 */
export class BusinessData1758000011000 implements MigrationInterface {
  name = 'BusinessData1758000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "sku"             varchar(64)  NOT NULL,
        "name"            varchar(300) NOT NULL,
        "description"     text,
        "price_cents"     bigint NOT NULL,
        "currency"        varchar(3) NOT NULL DEFAULT 'THB',
        "stock_quantity"  int NOT NULL DEFAULT 0,
        "attributes"      jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_active"       boolean NOT NULL DEFAULT true,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_product_org_sku" ON "products" ("organization_id", "sku")`,
    );
    // Product lookup is by name in practice — a customer types "iPhone 17 Pro",
    // not a SKU. trigram makes that ILIKE search usable.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`);
    await queryRunner.query(
      `CREATE INDEX "ix_product_name_trgm" ON "products" USING gin ("name" gin_trgm_ops)`,
    );

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "customer_id"     uuid REFERENCES "customers"("id") ON DELETE SET NULL,
        "order_number"    varchar(64) NOT NULL,
        "status"          "order_status" NOT NULL DEFAULT 'PENDING',
        "total_cents"     bigint NOT NULL,
        "currency"        varchar(3) NOT NULL DEFAULT 'THB',
        "tracking_number" varchar(100),
        "shipped_at"      timestamptz,
        "delivered_at"    timestamptz,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_order_org_number" ON "orders" ("organization_id", "order_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_order_customer" ON "orders" ("customer_id", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"         uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "product_id"       uuid REFERENCES "products"("id") ON DELETE SET NULL,
        "quantity"         int NOT NULL,
        "unit_price_cents" bigint NOT NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_order_item_order" ON "order_items" ("order_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "orders"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
  }
}
