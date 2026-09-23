import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 006 — AI usage and cost tracking (docs/DATABASE.md §3.7). */
export class AiUsageLogs1758000006000 implements MigrationInterface {
  name = 'AiUsageLogs1758000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_usage_logs" (
        "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"    uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "conversation_id"    uuid REFERENCES "conversations"("id") ON DELETE SET NULL,
        "message_id"         uuid REFERENCES "messages"("id") ON DELETE SET NULL,
        "purpose"            varchar(32)  NOT NULL,
        "provider"           varchar(64)  NOT NULL,
        "model"              varchar(100) NOT NULL,
        "input_tokens"       int NOT NULL DEFAULT 0,
        "output_tokens"      int NOT NULL DEFAULT 0,
        "total_tokens"       int NOT NULL DEFAULT 0,
        "estimated_cost_usd" numeric(12,6) NOT NULL DEFAULT 0,
        "latency_ms"         int NOT NULL DEFAULT 0,
        "success"            boolean NOT NULL DEFAULT true,
        "error_code"         varchar(100),
        "created_at"         timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_usage_org_created" ON "ai_usage_logs" ("organization_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_usage_conversation" ON "ai_usage_logs" ("conversation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_usage_logs"`);
  }
}
