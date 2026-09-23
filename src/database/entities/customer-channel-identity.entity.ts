import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from './base.entity';
import { ChannelType } from '../../common/constants';
import type { CustomerEntity } from './customer.entity';

/**
 * A provider-side user mapped to one of our customers.
 *
 * Unique on (organization, channel, externalUserId) — the same LINE account
 * talking to two businesses on this installation is deliberately two
 * customers, because a customer row carries that business's notes and tags.
 */
@Entity({ name: 'customer_channel_identities' })
@Index(
  'ux_channel_identity_org_channel_user',
  ['organizationId', 'channel', 'externalUserId'],
  { unique: true },
)
export class CustomerChannelIdentityEntity extends TenantEntity {
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Column({ type: 'enum', enum: ChannelType, enumName: 'channel_type' })
  channel!: ChannelType;

  @Column({ name: 'external_user_id', type: 'varchar', length: 200 })
  externalUserId!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 200, nullable: true })
  displayName!: string | null;

  @ManyToOne('CustomerEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer?: CustomerEntity;
}
