import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeDocumentEntity } from '@/models/entities';
import { AiModule } from '@/modules/ai/ai.module';
import { ChunkingService } from './chunking.service';
import { ExtractionService } from './extraction.service';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeDocumentEntity]),
    forwardRef(() => AiModule),
  ],
  providers: [ChunkingService, ExtractionService, IngestionService],
  exports: [ChunkingService, ExtractionService, IngestionService],
})
export class DocumentsModule {}
