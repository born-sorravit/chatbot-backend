import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { KnowledgeDocumentEntity } from './knowledge-document.entity';

/**
 * A retrievable slice of a document, with its embedding.
 *
 * `organizationId` is on the row itself and leads the retrieval WHERE clause —
 * an HNSW index is a pure ANN structure and knows nothing about tenancy, so
 * isolation here is entirely the query's job (R-01).
 */
@Entity({ name: 'knowledge_chunks' })
@Index('ix_chunk_org_kb', ['organizationId', 'knowledgeBaseId'])
@Index('ix_chunk_doc', ['documentId', 'chunkIndex'])
export class KnowledgeChunkEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** Denormalized from the document so retrieval filters without a join. */
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ name: 'token_count', type: 'int', default: 0 })
  tokenCount!: number;

  /**
   * pgvector column. TypeORM has no native mapping, so it is declared as text
   * and written through raw parameterised SQL — see EmbeddingsRepository.
   * Selected only when explicitly asked for: a 1024-float array on every row
   * of a list query is pure waste.
   */
  @Column({ type: 'text', select: false, nullable: true })
  embedding!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('KnowledgeDocumentEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document?: KnowledgeDocumentEntity;
}
