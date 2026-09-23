import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from './base.entity';
import type { OrganizationEntity } from './organization.entity';

/**
 * A person talking to the business.
 *
 * Every identity field is nullable: a customer opens the widget with none of
 * them, and they get filled in as the conversation reveals them
 * (docs/DATABASE.md §3.1).
 */
@Entity({ name: 'customers' })
@Index('ix_customers_org_email', ['organizationId', 'email'])
export class CustomerEntity extends TenantEntity {
  @Column({ type: 'varchar', length: 200, nullable: true })
  name!: string | null;

  @Column({ type: 'citext', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ type: 'text', array: true, default: () => "'{}'::text[]" })
  tags!: string[];

  /** Admin-only. Never serialised to the customer-facing chat API. */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @ManyToOne('OrganizationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;
}
