import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { EMBEDDING_DIMENSIONS } from '../common/constants';

export interface ChunkInsert {
  organizationId: string;
  knowledgeBaseId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  distance: number;
  metadata: Record<string, unknown>;
}

/** pgvector literal format: `[0.1,0.2,...]`. */
function toVectorLiteral(vector: number[]): string {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
    );
  }
  return `[${vector.join(',')}]`;
}

/**
 * Raw SQL access to the vector column.
 *
 * TypeORM has no `vector` mapping, so every read and write here is
 * hand-written and parameterised. This is the only place in the codebase that
 * touches pgvector directly.
 */
@Injectable()
export class EmbeddingsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Replaces a document's chunks atomically.
   *
   * Delete-then-insert inside one transaction, so a search never observes a
   * half-indexed document — re-indexing a live knowledge base would otherwise
   * briefly return partial results (docs/ARCHITECTURE.md §7.1).
   */
  async replaceDocumentChunks(
    documentId: string,
    organizationId: string,
    chunks: ChunkInsert[],
  ): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM knowledge_chunks WHERE document_id = $1 AND organization_id = $2`,
        [documentId, organizationId],
      );

      for (const chunk of chunks) {
        await manager.query(
          `INSERT INTO knowledge_chunks
             (organization_id, knowledge_base_id, document_id, chunk_index,
              content, token_count, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8::jsonb)`,
          [
            chunk.organizationId,
            chunk.knowledgeBaseId,
            chunk.documentId,
            chunk.chunkIndex,
            chunk.content,
            chunk.tokenCount,
            toVectorLiteral(chunk.embedding),
            JSON.stringify(chunk.metadata),
          ],
        );
      }

      return chunks.length;
    });
  }

  /**
   * Nearest chunks by cosine distance.
   *
   * `organization_id` is in the WHERE clause, not applied afterwards: an HNSW
   * index knows nothing about tenancy, so this predicate is the entire
   * isolation boundary for retrieval (R-01).
   *
   * Because Postgres runs the ANN scan and *then* filters, an over-filtered
   * query can return fewer rows than asked for — which is why callers fetch
   * `candidateK` and narrow to `topK` afterwards rather than requesting
   * `topK` directly.
   */
  async search(
    organizationId: string,
    knowledgeBaseIds: string[],
    queryVector: number[],
    limit: number,
    manager?: EntityManager,
  ): Promise<RetrievedChunk[]> {
    if (knowledgeBaseIds.length === 0) {
      return [];
    }

    const runner = manager ?? this.dataSource;

    const rows: {
      id: string;
      document_id: string;
      document_title: string;
      content: string;
      distance: string;
      metadata: Record<string, unknown>;
    }[] = await runner.query(
      `SELECT c.id,
              c.document_id,
              d.title AS document_title,
              c.content,
              c.metadata,
              (c.embedding <=> $1::vector) AS distance
         FROM knowledge_chunks c
         JOIN knowledge_documents d ON d.id = c.document_id
        WHERE c.organization_id = $2
          AND c.knowledge_base_id = ANY($3::uuid[])
          AND c.embedding IS NOT NULL
        ORDER BY c.embedding <=> $1::vector
        LIMIT $4`,
      [toVectorLiteral(queryVector), organizationId, knowledgeBaseIds, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      content: row.content,
      // Postgres returns numeric as a string over the wire.
      distance: Number(row.distance),
      metadata: row.metadata ?? {},
    }));
  }

  async countForDocument(documentId: string): Promise<number> {
    const rows: { count: string }[] = await this.dataSource.query(
      `SELECT count(*)::text AS count FROM knowledge_chunks WHERE document_id = $1`,
      [documentId],
    );
    return Number(rows[0]?.count ?? 0);
  }
}
