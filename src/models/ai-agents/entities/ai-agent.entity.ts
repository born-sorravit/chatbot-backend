import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';
import { DEFAULT_LLM_MODEL } from '@/shared/constants';
import type { OrganizationEntity } from '@/models/organizations/entities/organization.entity';

/**
 * A configured AI persona (master plan §16).
 *
 * Note the absence of `temperature`: current Claude models reject sampling
 * parameters with a 400, and depth is controlled by `effort` instead
 * (docs/ARCHITECTURE.md TD-13). Storing a knob the API refuses would be a
 * trap for whoever wires the UI.
 */
@Entity({ name: 'ai_agents' })
// Class-level and on organizationId: decorating `isDefault` would describe a
// single default row *globally*, which is not what migration 005 creates and
// not the invariant this system wants. `synchronize` is off so the live
// schema was never at risk, but the entity would have misled every reader.
@Index('ux_agent_default', ['organizationId'], { unique: true, where: '"is_default" = true' })
export class AiAgentEntity extends TenantEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Editable from the admin UI — §17 requires it. */
  @Column({ name: 'system_prompt', type: 'text' })
  systemPrompt!: string;

  @Column({ type: 'varchar', length: 10, default: 'th' })
  language!: string;

  @Column({ type: 'varchar', length: 32, default: 'friendly' })
  tone!: string;

  @Column({ type: 'varchar', length: 100, default: DEFAULT_LLM_MODEL })
  model!: string;

  @Column({ type: 'varchar', length: 16, default: 'low' })
  effort!: string;

  @Column({ name: 'max_tokens', type: 'int', default: 2048 })
  maxTokens!: number;

  @Column({ name: 'max_context_messages', type: 'int', default: 20 })
  maxContextMessages!: number;

  @Column({ name: 'auto_reply', type: 'boolean', default: true })
  autoReply!: boolean;

  @Column({ name: 'handoff_enabled', type: 'boolean', default: true })
  handoffEnabled!: boolean;

  /** Phase 4 reads this; stored now so the agent form is complete. */
  @Column({ name: 'rag_enabled', type: 'boolean', default: true })
  ragEnabled!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @ManyToOne('OrganizationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;
}
