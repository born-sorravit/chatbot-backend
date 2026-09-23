import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 005 — AI agents (docs/DATABASE.md §3.3).
 *
 * `ai_agent_knowledge_bases` deliberately lives in migration 007, not here:
 * it has an FK to `knowledge_bases`, which does not exist until Phase 4, and
 * a join table belongs in the migration that creates the *later* of its two
 * parents.
 */
export class AiAgents1758000005000 implements MigrationInterface {
  name = 'AiAgents1758000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_agents" (
        "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"      uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name"                 varchar(200) NOT NULL,
        "description"          text,
        "system_prompt"        text NOT NULL,
        "language"             varchar(10)  NOT NULL DEFAULT 'th',
        "tone"                 varchar(32)  NOT NULL DEFAULT 'friendly',
        "model"                varchar(100) NOT NULL DEFAULT 'claude-opus-5',
        "effort"               varchar(16)  NOT NULL DEFAULT 'low',
        "max_tokens"           int  NOT NULL DEFAULT 2048,
        "max_context_messages" int  NOT NULL DEFAULT 20,
        "auto_reply"           boolean NOT NULL DEFAULT true,
        "handoff_enabled"      boolean NOT NULL DEFAULT true,
        "rag_enabled"          boolean NOT NULL DEFAULT true,
        "is_default"           boolean NOT NULL DEFAULT false,
        "is_active"            boolean NOT NULL DEFAULT true,
        "created_at"           timestamptz NOT NULL DEFAULT now(),
        "updated_at"           timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE INDEX "ix_agents_org" ON "ai_agents" ("organization_id")`);

    // "Exactly one default agent per organization" as a database invariant
    // rather than something application code has to remember.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ux_agent_default" ON "ai_agents" ("organization_id") WHERE "is_default" = true`,
    );

    // conversations.ai_agent_id was created nullable in 004; the FK can only
    // be added now that the target table exists.
    await queryRunner.query(
      `ALTER TABLE "conversations" ADD CONSTRAINT "fk_conv_ai_agent" FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "fk_conv_ai_agent"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_agents"`);
  }
}
