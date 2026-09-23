import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantEntity } from '@/models/base.entity';
import { UserRole } from '@/shared/constants/permissions';
import type { OrganizationEntity } from '@/models/organizations/entities/organization.entity';
import type { RefreshTokenEntity } from '@/models/auth/entities/refresh-token.entity';

@Entity({ name: 'users' })
@Index('ux_users_org_email', ['organizationId', 'email'], { unique: true })
export class UserEntity extends TenantEntity {
  /**
   * `citext` — case-insensitive comparison happens in the database, so the
   * unique index is on the plain column with no lower() wrapper
   * (docs/DATABASE.md §3.1).
   */
  @Column({ type: 'citext' })
  email!: string;

  /**
   * argon2id hash. Excluded from every select by default so it cannot be
   * serialised into a response by accident — a query that needs it must ask
   * for it explicitly.
   */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role', default: UserRole.Agent })
  role!: UserRole;

  /** Extra grants layered on top of the role baseline. Never revokes. */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  permissions!: string[];

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @ManyToOne('OrganizationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @OneToMany('RefreshTokenEntity', (token: RefreshTokenEntity) => token.user)
  refreshTokens?: RefreshTokenEntity[];
}
