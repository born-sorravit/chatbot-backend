import { Global, Module } from '@nestjs/common';
import { EmbeddingsRepository } from './embeddings.repository';

/**
 * Global because both the ingestion pipeline and RAG retrieval need it, and
 * they live in different module trees.
 */
@Global()
@Module({
  providers: [EmbeddingsRepository],
  exports: [EmbeddingsRepository],
})
export class EmbeddingsModule {}
