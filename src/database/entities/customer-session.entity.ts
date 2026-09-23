import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { TenantEntity } from './base.entity';
import type { CustomerEntity } from './customer.entity';

/**
 * Anonymous customer authentication (docs/ARCHITECTURE.md TD-09).
 *
 * Hashed like refresh tokens, for the same reason. The token authorizes one
 * customer's chat, not the organization.
 *
 * Created in Phase 1 alongside the Customer entity; consumed by the chat
 * endpoints in Phase 2.
 */
@Entity({ name: 'customer_sessions' })
export class CustomerSessionEntity extends TenantEntity {
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  @Index('ux_customer_sessions_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @ManyToOne('CustomerEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'customer_id' })
  customer?: CustomerEntity;
}
