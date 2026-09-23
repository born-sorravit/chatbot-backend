import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 013 — external channel integrations and identities (docs/DATABASE.md §3.7). */
export class Channels1758000013000 implements MigrationInterface {
  name = 'Channels1758000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "channel_type" AS ENUM ('line', 'facebook', 'whatsapp')
    `);

    // One row per connected provider account. `conversations.channel` stays
    // varchar on purpose (DATABASE.md §282) — this enum constrains the
    // integration table only, so no migration touches the large table.
    await queryRunner.query(`
      CREATE TABLE "channel_integrations" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "channel"             "channel_type" NOT NULL,
        "display_name"        varchar(200) NOT NULL,
        -- The provider's own account id: LINE destination, Facebook page id,
        -- WhatsApp phone_number_id. Used to route an inbound payload that
        -- carries no integration id of ours.
        "external_account_id" varchar(200),
        -- Secrets. Never returned by the admin API (masked on read).
        "credentials"         jsonb NOT NULL DEFAULT '{}'::jsonb,
        "is_active"           boolean NOT NULL DEFAULT true,
        "last_inbound_at"     timestamptz,
        "last_error"          text,
        "created_at"          timestamptz NOT NULL DEFAULT now(),
        "updated_at"          timestamptz NOT NULL DEFAULT now()
      )
    `);

    // One integration per channel per organization. Two rows for the same
    // channel would make "which credentials sign this reply?" ambiguous.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_channel_integration_org_channel"
         ON "channel_integrations" ("organization_id", "channel")`,
    );

    // The routing key for inbound traffic. Partial, because the account id is
    // unknown until the first webhook arrives for some providers.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_channel_integration_account"
         ON "channel_integrations" ("channel", "external_account_id")
       WHERE "external_account_id" IS NOT NULL`,
    );

    // Maps a provider-side user to one of our customers. A separate table
    // rather than columns on `customers`: one person may reach the same
    // business on LINE and on WhatsApp, and those are different identities
    // that should be able to converge on one customer row later.
    await queryRunner.query(`
      CREATE TABLE "customer_channel_identities" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"  uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "customer_id"      uuid NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
        "channel"          "channel_type" NOT NULL,
        "external_user_id" varchar(200) NOT NULL,
        "display_name"     varchar(200),
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        "updated_at"       timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Scoped by organization as well as channel: the same LINE user talking
    // to two businesses on this installation is two customers, and must not
    // collapse into one.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_channel_identity_org_channel_user"
         ON "customer_channel_identities" ("organization_id", "channel", "external_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_channel_identity_customer"
         ON "customer_channel_identities" ("customer_id")`,
    );

    // Inbound idempotency. Providers retry a webhook until they get a 200,
    // so the same provider message id can arrive several times; without this
    // the customer's single message becomes three, and the AI answers thrice.
    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "external_id" varchar(200)`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_message_org_external_id"
         ON "messages" ("organization_id", "external_id")
       WHERE "external_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_message_org_external_id"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "external_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_channel_identities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "channel_integrations"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "channel_type"`);
  }
}
