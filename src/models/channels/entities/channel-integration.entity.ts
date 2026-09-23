import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';
import { ChannelType } from '@/shared/constants';
import type { OrganizationEntity } from '@/models/organizations/entities/organization.entity';

/**
 * Credentials for one connected provider account.
 *
 * Shape varies by provider, which is why this is jsonb rather than columns:
 * LINE needs a channel secret and an access token, Meta needs an app secret,
 * a page access token and a verify token. Each adapter declares which keys it
 * requires and validates them on save.
 */
export interface ChannelCredentials {
  [key: string]: string | undefined;
}

@Entity({ name: 'channel_integrations' })
@Index('ux_channel_integration_org_channel', ['organizationId', 'channel'], { unique: true })
export class ChannelIntegrationEntity extends TenantEntity {
  @Column({ type: 'enum', enum: ChannelType, enumName: 'channel_type' })
  channel!: ChannelType;

  @Column({ name: 'display_name', type: 'varchar', length: 200 })
  displayName!: string;

  @Column({ name: 'external_account_id', type: 'varchar', length: 200, nullable: true })
  externalAccountId!: string | null;

  /** Never serialised to the admin API — see `toChannelIntegrationView`. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  credentials!: ChannelCredentials;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_inbound_at', type: 'timestamptz', nullable: true })
  lastInboundAt!: Date | null;

  /** Last delivery or verification failure, surfaced in the admin UI. */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @ManyToOne('OrganizationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;
}
