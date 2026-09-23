import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';
import { DocumentSource, DocumentStatus } from '@/shared/constants';
import type { KnowledgeBaseEntity } from './knowledge-base.entity';

@Entity({ name: 'knowledge_documents' })
@Index('ix_doc_kb_status', ['knowledgeBaseId', 'status'])
export class KnowledgeDocumentEntity extends TenantEntity {
  @Column({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId!: string;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  /** Extracted plain text — what actually gets chunked. */
  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({
    name: 'source_type',
    type: 'enum',
    enum: DocumentSource,
    enumName: 'document_source',
  })
  sourceType!: DocumentSource;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl!: string | null;

  /** Object key for an uploaded PDF. Never a public URL. */
  @Column({ name: 'storage_key', type: 'text', nullable: true })
  storageKey!: string | null;

  @Column({
    type: 'enum',
    enum: DocumentStatus,
    enumName: 'document_status',
    default: DocumentStatus.Pending,
  })
  status!: DocumentStatus;

  /**
   * Surfaced in the admin UI on FAILED.
   *
   * §38 requires a visible failed state, and "failed" with no reason is not
   * actionable for someone who just uploaded a scanned PDF with no text layer.
   */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'chunk_count', type: 'int', default: 0 })
  chunkCount!: number;

  @Column({ name: 'indexed_at', type: 'timestamptz', nullable: true })
  indexedAt!: Date | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @ManyToOne('KnowledgeBaseEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'knowledge_base_id' })
  knowledgeBase?: KnowledgeBaseEntity;
}
