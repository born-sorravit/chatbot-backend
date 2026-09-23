import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBaseEntity, KnowledgeDocumentEntity } from '../database/entities';
import { AiModule } from '../ai/ai.module';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { DocumentsModule } from '../documents/documents.module';
import { KnowledgeIngestionQueue } from '../queue/knowledge-ingestion.queue';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { DocumentsController } from './documents.controller';
import {
  DocumentsRepository,
  KnowledgeBaseService,
  KnowledgeBasesRepository,
} from './knowledge-base.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBaseEntity, KnowledgeDocumentEntity]),
    EmbeddingsModule,
    forwardRef(() => AiModule),
    forwardRef(() => DocumentsModule),
  ],
  controllers: [KnowledgeBaseController, DocumentsController],
  providers: [
    KnowledgeBasesRepository,
    DocumentsRepository,
    KnowledgeBaseService,
    KnowledgeIngestionQueue,
  ],
  exports: [KnowledgeBaseService, KnowledgeBasesRepository, DocumentsRepository],
})
export class KnowledgeBaseModule {}
