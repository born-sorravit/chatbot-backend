import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeDocumentEntity } from '@/models/entities';
import { TenantScopedRepository } from '@/models/tenant-scoped.repository';

@Injectable()
export class DocumentsRepository extends TenantScopedRepository<KnowledgeDocumentEntity> {
  constructor(
    @InjectRepository(KnowledgeDocumentEntity) repository: Repository<KnowledgeDocumentEntity>,
  ) {
    super(repository, 'Document');
  }
}
