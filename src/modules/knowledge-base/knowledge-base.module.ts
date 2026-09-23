import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBaseEntity, KnowledgeDocumentEntity } from '@/models/entities';
import { AiModule } from '@/modules/ai/ai.module';
import { DocumentsModule } from '@/modules/documents/documents.module';
import { KnowledgeIngestionQueue } from '@/modules/queue/knowledge-ingestion.queue';
import { KnowledgeBaseController } from './knowledge-base.controller';
import { DocumentsController } from './documents.controller';
import { KnowledgeBaseService } from './knowledge-base.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([KnowledgeBaseEntity, KnowledgeDocumentEntity]),
    forwardRef(() => AiModule),
    forwardRef(() => DocumentsModule),
  ],
  controllers: [KnowledgeBaseController, DocumentsController],
  providers: [KnowledgeBaseService, KnowledgeIngestionQueue],
  exports: [KnowledgeBaseService],
})
export class KnowledgeBaseModule {}
