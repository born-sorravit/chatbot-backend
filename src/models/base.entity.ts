import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
  Index,
} from 'typeorm';

export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/**
 * Base for every tenant-owned entity (docs/DATABASE.md §4, layer 1).
 *
 * `organizationId` is non-nullable and present on the row itself — including
 * on entities that could technically reach it through a join — so isolation
 * never depends on a join being written correctly.
 */
export abstract class TenantEntity extends BaseEntity {
  @Index()
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;
}
