import type { MigrationInterface, QueryRunner } from 'typeorm';
import { EMBEDDING_DIMENSIONS } from '@/shared/constants';

/**
 * Migration 008 — the vector table (docs/DATABASE.md §3.4).
 *
 * The embedding width is read from EMBEDDING_DIMENSIONS so the schema and the
 * boot-time assertion cannot drift. It is still a schema-level commitment:
 * changing that constant requires altering this column *and* re-embedding
 * every chunk, which is why it is a migration rather than configuration
 * (docs/ARCHITECTURE.md TD-07).
 */
export class KnowledgeChunksVector1758000008000 implements MigrationInterface {
  name = 'KnowledgeChunksVector1758000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);

    await queryRunner.query(`
      CREATE TABLE "knowledge_chunks" (
        "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "organization_id"   uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
        "knowledge_base_id" uuid NOT NULL REFERENCES "knowledge_bases"("id") ON DELETE CASCADE,
        "document_id"       uuid NOT NULL REFERENCES "knowledge_documents"("id") ON DELETE CASCADE,
        "chunk_index"       int  NOT NULL,
        "content"           text NOT NULL,
        "token_count"       int  NOT NULL DEFAULT 0,
        "embedding"         vector(${EMBEDDING_DIMENSIONS}),
        "metadata"          jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at"        timestamptz NOT NULL DEFAULT now()
      )
    `);

    // organization_id leads because every retrieval filters on it first.
    await queryRunner.query(
      `CREATE INDEX "ix_chunk_org_kb" ON "knowledge_chunks" ("organization_id", "knowledge_base_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_chunk_doc" ON "knowledge_chunks" ("document_id", "chunk_index")`,
    );

    // HNSW over IVFFlat: IVFFlat needs a training pass over existing rows, so
    // an index built on an empty table is worthless — which is exactly a new
    // tenant's starting state. HNSW builds incrementally and is accurate from
    // the first row.
    await queryRunner.query(
      `CREATE INDEX "ix_chunk_embedding" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_chunks"`);
  }
}
