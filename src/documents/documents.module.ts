import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocumentEntity } from '../database/entities';
import { AiModule } from '../ai/ai.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ChunkingService } from './chunking.service';
import { ExtractionService } from './extraction.service';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeDocumentEntity]),
    EmbeddingsModule,
    forwardRef(() => AiModule),
  ],
  providers: [ChunkingService, ExtractionService, IngestionService],
  exports: [ChunkingService, ExtractionService, IngestionService],
})
export class DocumentsModule {}
