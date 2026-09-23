import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeDocumentEntity } from '../database/entities';
import { DocumentStatus } from '../common/constants';
import { AppConfig } from '../config';
import { ExtractionService } from './extraction.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingsRepository } from '../embeddings/embeddings.repository';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../ai/providers/embedding.provider';
import { Inject } from '@nestjs/common';

export interface IngestResult {
  chunkCount: number;
  tokenCount: number;
}

/**
 * The ingestion pipeline (master plan §22).
 *
 *   document → extract → clean → chunk → embed → pgvector
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    @InjectRepository(KnowledgeDocumentEntity)
    private readonly documents: Repository<KnowledgeDocumentEntity>,
    private readonly extraction: ExtractionService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsRepository,
    private readonly config: AppConfig,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
  ) {}

  async ingest(organizationId: string, documentId: string): Promise<IngestResult> {
    const document = await this.documents.findOne({
      where: { id: documentId, organizationId },
    });

    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }

    await this.documents.update(
      { id: documentId },
      { status: DocumentStatus.Processing, errorMessage: null },
    );

    try {
      const extracted = await this.extraction.extract({
        sourceType: document.sourceType,
        content: document.content,
        sourceUrl: document.sourceUrl,
        // PDF bytes are handled by the upload path, which stores the
        // extracted text on the document before enqueueing.
        buffer: null,
      });

      const chunks = this.chunking.chunk(extracted.text, {
        documentId,
        sourceType: document.sourceType,
      });

      if (chunks.length === 0) {
        throw new Error('ไม่สามารถแบ่งเนื้อหาเป็นส่วนย่อยได้ — เนื้อหาอาจสั้นเกินไป');
      }

      // Batched: providers are rate-limited per request, so a 200-chunk
      // document sent one call at a time is the difference between a working
      // pipeline and a throttled one.
      const vectors: number[][] = [];
      const batchSize = this.config.embeddingBatchSize;

      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const embedded = await this.provider.embedMany(
          batch.map((chunk) => chunk.content),
          'document',
        );
        vectors.push(...embedded);
      }

      const stored = await this.embeddings.replaceDocumentChunks(
        documentId,
        organizationId,
        chunks.map((chunk, index) => ({
          organizationId,
          knowledgeBaseId: document.knowledgeBaseId,
          documentId,
          chunkIndex: chunk.index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: vectors[index],
          metadata: chunk.metadata,
        })),
      );

      const tokenCount = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

      // The extracted text is stored so re-indexing does not have to re-fetch
      // a URL or re-parse a PDF.
      document.content = extracted.text;
      document.status = DocumentStatus.Ready;
      document.chunkCount = stored;
      document.indexedAt = new Date();
      document.errorMessage = null;
      document.metadata = { ...document.metadata, ...extracted.metadata };

      await this.documents.save(document);

      this.logger.log({
        event: 'kb.ingested',
        documentId,
        organizationId,
        chunks: stored,
        tokenCount,
      });

      return { chunkCount: stored, tokenCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // The message is written to the row because §38 requires a visible
      // FAILED state, and "failed" with no reason is not actionable.
      await this.documents.update(
        { id: documentId },
        { status: DocumentStatus.Failed, errorMessage: message.slice(0, 500) },
      );

      this.logger.error({ event: 'kb.ingest_failed', documentId, message });
      throw error;
    }
  }
}
