import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KnowledgeBaseEntity } from '@/models/entities';
import { TenantScopedRepository } from '@/models/tenant-scoped.repository';

@Injectable()
export class KnowledgeBasesRepository extends TenantScopedRepository<KnowledgeBaseEntity> {
  constructor(@InjectRepository(KnowledgeBaseEntity) repository: Repository<KnowledgeBaseEntity>) {
    super(repository, 'Knowledge base');
  }
}
