import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { KnowledgeBaseEntity } from '@/models/entities';
import { DocumentsRepository } from '@/models/knowledge-base/documents.repository';
import { KnowledgeBasesRepository } from '@/models/knowledge-base/knowledge-bases.repository';
import { DocumentSource, DocumentStatus } from '@/shared/constants';
import { KnowledgeIngestionQueue } from '@/modules/queue/knowledge-ingestion.queue';
import { EmbeddingsRepository } from '@/models/knowledge-base/embeddings.repository';
import type { CreateDocumentDto, ListDocumentsDto, UpsertKnowledgeBaseDto } from './dto';

@Injectable()
export class KnowledgeBaseService {
  constructor(
    private readonly knowledgeBases: KnowledgeBasesRepository,
    private readonly documents: DocumentsRepository,
    private readonly ingestion: KnowledgeIngestionQueue,
    private readonly embeddings: EmbeddingsRepository,
  ) {}

  /* ── knowledge bases ─────────────────────────────────────────────── */

  list(organizationId: string) {
    return this.knowledgeBases.findMany(organizationId, { order: { createdAt: 'ASC' } });
  }

  findById(organizationId: string, id: string) {
    return this.knowledgeBases.findByIdOrFail(organizationId, id);
  }

  create(organizationId: string, dto: UpsertKnowledgeBaseDto) {
    return this.knowledgeBases.create(organizationId, dto);
  }

  update(organizationId: string, id: string, dto: Partial<UpsertKnowledgeBaseDto>) {
    return this.knowledgeBases.updateById(organizationId, id, dto);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    // Chunks and documents cascade from the knowledge base, so nothing is
    // orphaned — but an agent still linked to it would silently lose its
    // knowledge, which the caller should notice rather than discover later.
    await this.knowledgeBases.deleteById(organizationId, id);
  }

  /* ── documents ───────────────────────────────────────────────────── */

  async listDocuments(organizationId: string, knowledgeBaseId: string, query: ListDocumentsDto) {
    await this.knowledgeBases.findByIdOrFail(organizationId, knowledgeBaseId);

    return this.documents.findMany(organizationId, {
      where: {
        knowledgeBaseId,
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Creates a document and queues it for indexing.
   *
   * Returns immediately with status PENDING: extraction, chunking and
   * embedding all happen in the worker, because a large PDF or a slow URL
   * would otherwise hold an HTTP request open for minutes.
   */
  async createDocument(
    organizationId: string,
    knowledgeBaseId: string,
    dto: CreateDocumentDto,
  ) {
    await this.knowledgeBases.findByIdOrFail(organizationId, knowledgeBaseId);

    const document = await this.documents.create(organizationId, {
      knowledgeBaseId,
      title: dto.title,
      sourceType: dto.sourceType,
      content: dto.sourceType === DocumentSource.Url ? null : (dto.content ?? null),
      sourceUrl: dto.sourceType === DocumentSource.Url ? (dto.sourceUrl ?? null) : null,
      status: DocumentStatus.Pending,
      metadata: {},
    });

    await this.enqueueIngestion(organizationId, knowledgeBaseId, document.id);

    return document;
  }

  async reindexDocument(organizationId: string, documentId: string) {
    const document = await this.documents.findByIdOrFail(organizationId, documentId);

    if (document.status === DocumentStatus.Processing) {
      throw new ConflictException({
        code: 'DOCUMENT_PROCESSING',
        message: 'Document is already being indexed',
      });
    }

    await this.documents.updateById(organizationId, documentId, {
      status: DocumentStatus.Pending,
      errorMessage: null,
    });

    await this.enqueueIngestion(organizationId, document.knowledgeBaseId, documentId);

    return this.documents.findByIdOrFail(organizationId, documentId);
  }

  async removeDocument(organizationId: string, documentId: string): Promise<void> {
    await this.documents.deleteById(organizationId, documentId);
  }

  async documentChunkCount(organizationId: string, documentId: string): Promise<number> {
    await this.documents.findByIdOrFail(organizationId, documentId);
    return this.embeddings.countForDocument(documentId);
  }

  /**
   * A document that cannot be queued must not sit at PENDING forever with no
   * explanation — mark it FAILED so the admin sees a reason and can retry.
   */
  private async enqueueIngestion(
    organizationId: string,
    knowledgeBaseId: string,
    documentId: string,
  ): Promise<void> {
    try {
      await this.ingestion.enqueue({ organizationId, knowledgeBaseId, documentId });
    } catch (error) {
      await this.documents.updateById(organizationId, documentId, {
        status: DocumentStatus.Failed,
        errorMessage:
          'ไม่สามารถเข้าคิวประมวลผลได้ — ระบบคิวอาจไม่พร้อมใช้งาน กรุณาลอง Re-index อีกครั้ง',
      });
      throw error;
    }
  }

  async requireKnowledgeBase(organizationId: string, id: string): Promise<KnowledgeBaseEntity> {
    const kb = await this.knowledgeBases.findById(organizationId, id);

    if (!kb) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }

    return kb;
  }
}
