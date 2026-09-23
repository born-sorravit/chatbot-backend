import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Migration 010 — tool registry, allowlist and execution log (docs/DATABASE.md §3.5). */
export class Tools1758000010000 implements MigrationInterface {
  name = 'Tools1758000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_tools" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name"            varchar(100) NOT NULL,
        "description"     text NOT NULL,
        "input_schema"    jsonb NOT NULL,
        "mutating"        boolean NOT NULL DEFAULT false,
        "is_active"       boolean NOT NULL DEFAULT true,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_tool_org_name" ON "ai_tools" ("organization_id", "name")`,
    );

    // The allowlist. A tool absent from here cannot be called (§25).
    await queryRunner.query(`
      CREATE TABLE "ai_agent_tools" (
        "ai_agent_id"       uuid NOT NULL REFERENCES "ai_agents"("id") ON DELETE CASCADE,
        "ai_tool_id"        uuid NOT NULL REFERENCES "ai_tools"("id") ON DELETE CASCADE,
        "organization_id"   uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "enabled"           boolean NOT NULL DEFAULT true,
        "requires_approval" boolean NOT NULL DEFAULT false,
        PRIMARY KEY ("ai_agent_id", "ai_tool_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_agent_tool_agent" ON "ai_agent_tools" ("ai_agent_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "tool_executions" (
        "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "conversation_id"     uuid REFERENCES "conversations"("id") ON DELETE CASCADE,
        "message_id"          uuid REFERENCES "messages"("id") ON DELETE SET NULL,
        -- RESTRICT would block deleting a tool that has history; SET NULL keeps
        -- the log readable because tool_name is copied onto the row.
        "ai_tool_id"          uuid REFERENCES "ai_tools"("id") ON DELETE SET NULL,
        "tool_name"           varchar(100) NOT NULL,
        "input"               jsonb NOT NULL DEFAULT '{}'::jsonb,
        "output"              jsonb,
        "status"              "tool_exec_status" NOT NULL DEFAULT 'RUNNING',
        "error_message"       text,
        "approved_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "duration_ms"         int,
        "created_at"          timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_toolexec_org_created" ON "tool_executions" ("organization_id", "created_at" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_toolexec_conv" ON "tool_executions" ("conversation_id", "created_at" DESC)`,
    );
    // Partial index — the approval queue only ever asks for pending rows.
    await queryRunner.query(
      `CREATE INDEX "ix_toolexec_pending" ON "tool_executions" ("organization_id") WHERE "status" = 'PENDING_APPROVAL'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tool_executions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_agent_tools"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_tools"`);
  }
}
