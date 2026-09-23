import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 009 — admin notifications (docs/DATABASE.md §3.7). */
export class Notifications1758000009000 implements MigrationInterface {
  name = 'Notifications1758000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "notifications" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "type"            "notification_type" NOT NULL,
        "title"           varchar(200) NOT NULL,
        "message"         text NOT NULL,
        "conversation_id" uuid REFERENCES "conversations"("id") ON DELETE CASCADE,
        "metadata"        jsonb NOT NULL DEFAULT '{}'::jsonb,
        "read_at"         timestamptz,
        "created_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Partial index: the badge count only ever asks for unread rows, and a
    // busy organization accumulates read ones indefinitely.
    await queryRunner.query(
      `CREATE INDEX "ix_notif_user_unread" ON "notifications" ("user_id", "created_at" DESC) WHERE "read_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_notif_user_created" ON "notifications" ("user_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_notif_conversation" ON "notifications" ("conversation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
  }
}
