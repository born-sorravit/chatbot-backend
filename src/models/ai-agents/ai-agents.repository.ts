import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiAgentEntity } from '@/models/entities';
import { TenantScopedRepository } from '@/models/tenant-scoped.repository';

@Injectable()
export class AiAgentsRepository extends TenantScopedRepository<AiAgentEntity> {
  constructor(@InjectRepository(AiAgentEntity) repository: Repository<AiAgentEntity>) {
    super(repository, 'AI agent');
  }
}
