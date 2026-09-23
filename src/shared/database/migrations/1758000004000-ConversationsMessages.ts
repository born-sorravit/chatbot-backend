import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 004 — conversations, messages, attachments (docs/DATABASE.md §3.2). */
export class ConversationsMessages1758000004000 implements MigrationInterface {
  name = 'ConversationsMessages1758000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "conversations" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"       uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "customer_id"           uuid NOT NULL REFERENCES "customers"("id") ON DELETE RESTRICT,
        -- ai_agents does not exist until migration 005, so the FK is added there.
        "ai_agent_id"           uuid,
        "assigned_user_id"      uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "status"                "conversation_status" NOT NULL DEFAULT 'OPEN',
        "mode"                  "conversation_mode"   NOT NULL DEFAULT 'AI',
        "channel"               varchar(32)  NOT NULL DEFAULT 'web',
        "summary"               text,
        "summary_updated_at"    timestamptz,
        "handoff_reason"        "handoff_reason",
        "handoff_at"            timestamptz,
        "unread_admin_count"    int NOT NULL DEFAULT 0,
        "unread_customer_count" int NOT NULL DEFAULT 0,
        "last_message_at"       timestamptz,
        "closed_at"             timestamptz,
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "updated_at"            timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Every index leads with organization_id because every query filters on it.
    await queryRunner.query(
      `CREATE INDEX "ix_conv_org_last" ON "conversations" ("organization_id", "last_message_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conv_org_status" ON "conversations" ("organization_id", "status", "last_message_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conv_org_mode" ON "conversations" ("organization_id", "mode", "last_message_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conv_org_assigned" ON "conversations" ("organization_id", "assigned_user_id") WHERE "assigned_user_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_conv_customer" ON "conversations" ("customer_id", "created_at" DESC)`,
    );

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"    uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "conversation_id"    uuid NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE,
        "sender_type"        "message_sender_type" NOT NULL,
        "sender_id"          uuid,
        "content"            text,
        "type"               "message_type" NOT NULL DEFAULT 'TEXT',
        "trigger_message_id" uuid REFERENCES "messages"("id") ON DELETE SET NULL,
        "metadata"           jsonb NOT NULL DEFAULT '{}'::jsonb,
        "read_at"            timestamptz,
        "created_at"         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_msg_conv_created" ON "messages" ("conversation_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_msg_org_created" ON "messages" ("organization_id", "created_at" DESC)`,
    );

    // At most one AI reply per customer message. This is the database half of
    // R-04: the deterministic BullMQ jobId stops most duplicates, and this
    // catches a retry that lands after the dedup window (docs/DATABASE.md §3.2).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_msg_ai_trigger" ON "messages" ("trigger_message_id") WHERE "sender_type" = 'AI' AND "trigger_message_id" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE "message_attachments" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "message_id"      uuid NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE,
        "storage_key"     text NOT NULL,
        "file_name"       varchar(255) NOT NULL,
        "mime_type"       varchar(127) NOT NULL,
        "size_bytes"      bigint NOT NULL,
        "width"           int,
        "height"          int,
        "created_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_attachment_message" ON "message_attachments" ("message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "message_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "conversations"`);
  }
}
