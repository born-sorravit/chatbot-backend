import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Security-relevant actions (master plan §42).
 *
 * Deliberately coarse: who did what to which resource, and when. Not a
 * change-data-capture log — recording every field of every update would bury
 * the handful of events anyone actually goes looking for.
 */
@Entity({ name: 'audit_logs' })
@Index('ix_audit_org_created', ['organizationId', 'createdAt'])
@Index('ix_audit_resource', ['resourceType', 'resourceId'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  /** USER | SYSTEM | AI — an AI-initiated action is not a user action. */
  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType!: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  /** Dotted verb, e.g. `conversation.takeover`, `tool.execute`. */
  @Column({ type: 'varchar', length: 100 })
  action!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 64 })
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'uuid', nullable: true })
  resourceId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  changes!: Record<string, unknown>;

  @Column({ type: 'inet', nullable: true })
  ip!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
