import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '@/models/base.entity';
import type { UserEntity } from '@/models/users/entities/user.entity';

/**
 * Refresh tokens are stored as sha256 hashes, never in plaintext
 * (docs/DATABASE.md §3.1) — a database leak must not hand over live sessions.
 *
 * Rotation: each use issues a new token and revokes the presented one.
 * Presenting an already-revoked token revokes the whole family, because that
 * pattern means the token was stolen and replayed.
 */
@Entity({ name: 'refresh_tokens' })
export class RefreshTokenEntity extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index('ux_refresh_hash', { unique: true })
  @Column({ name: 'token_hash', type: 'varchar', length: 255 })
  tokenHash!: string;

  /**
   * Groups rotated tokens descended from one login, so a detected replay can
   * revoke every descendant rather than just the one presented.
   */
  @Column({ name: 'family_id', type: 'uuid' })
  familyId!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @ManyToOne('UserEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: UserEntity;
}
