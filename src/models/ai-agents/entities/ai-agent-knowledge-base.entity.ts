import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Which knowledge bases an agent may retrieve from (master plan §37).
 *
 * Created in migration 007, not 005: it FKs `knowledge_bases`, and a join
 * table belongs in the migration that creates the later of its two parents
 * (docs/DATABASE.md §5).
 */
@Entity({ name: 'ai_agent_knowledge_bases' })
export class AiAgentKnowledgeBaseEntity {
  @PrimaryColumn({ name: 'ai_agent_id', type: 'uuid' })
  aiAgentId!: string;

  @PrimaryColumn({ name: 'knowledge_base_id', type: 'uuid' })
  knowledgeBaseId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;
}
