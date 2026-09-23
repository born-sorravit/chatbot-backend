import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';
import type { OrganizationEntity } from '@/models/organizations/entities/organization.entity';

/**
 * Tool *metadata* (master plan §25).
 *
 * The executable body lives in the code registry, never here. A database row
 * cannot introduce a new capability — which is what "AI must not call
 * arbitrary APIs" means in practice. This table only records which tools
 * exist for an organization and how they are described to the model.
 */
@Entity({ name: 'ai_tools' })
@Index('ux_tool_org_name', ['organizationId', 'name'], { unique: true })
export class AiToolEntity extends TenantEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /**
   * Sent to the model. Wording measurably affects whether it picks the right
   * tool, so this is editable by admins.
   */
  @Column({ type: 'text' })
  description!: string;

  /** JSON Schema derived from the registry's Zod schema. */
  @Column({ name: 'input_schema', type: 'jsonb' })
  inputSchema!: Record<string, unknown>;

  /**
   * Whether the tool changes data. Mutating tools require human approval
   * before they run (§25). Present from the start rather than retrofitted,
   * so the approval path exists before any mutating tool does.
   */
  @Column({ type: 'boolean', default: false })
  mutating!: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @ManyToOne('OrganizationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;
}
