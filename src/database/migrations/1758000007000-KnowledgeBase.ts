import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 007 — knowledge bases, documents, and the agent↔KB join
 * (docs/DATABASE.md §3.4).
 *
 * `ai_agent_knowledge_bases` lives here rather than in 005 because it FKs
 * `knowledge_bases`: a join table belongs in the migration creating the later
 * of its two parents.
 */
export class KnowledgeBase1758000007000 implements MigrationInterface {
  name = 'KnowledgeBase1758000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "knowledge_bases" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "name"            varchar(200) NOT NULL,
        "description"     text,
        "is_active"       boolean NOT NULL DEFAULT true,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_kb_org" ON "knowledge_bases" ("organization_id")`);

    await queryRunner.query(`
      CREATE TABLE "knowledge_documents" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"   uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "knowledge_base_id" uuid NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "title"             varchar(500) NOT NULL,
        "content"           text,
        "source_type"       "document_source" NOT NULL,
        "source_url"        text,
        "storage_key"       text,
        "status"            "document_status" NOT NULL DEFAULT 'PENDING',
        "error_message"     text,
        "chunk_count"       int NOT NULL DEFAULT 0,
        "indexed_at"        timestamptz,
        "metadata"          jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at"        timestamptz NOT NULL DEFAULT now(),
        "updated_at"        timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_doc_kb_status" ON "knowledge_documents" ("knowledge_base_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_doc_org" ON "knowledge_documents" ("organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "ai_agent_knowledge_bases" (
        "ai_agent_id"       uuid NOT NULL REFERENCES "ai_agents"("id") ON DELETE CASCADE,
        "knowledge_base_id" uuid NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "organization_id"   uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        PRIMARY KEY ("ai_agent_id", "knowledge_base_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_agent_kb_agent" ON "ai_agent_knowledge_bases" ("ai_agent_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_agent_knowledge_bases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_bases"`);
  }
}
