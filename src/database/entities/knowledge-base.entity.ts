import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantEntity } from './base.entity';
import type { OrganizationEntity } from './organization.entity';
import type { KnowledgeDocumentEntity } from './knowledge-document.entity';

/** A named collection of business knowledge (master plan §20). */
@Entity({ name: 'knowledge_bases' })
export class KnowledgeBaseEntity extends TenantEntity {
  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @ManyToOne('OrganizationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization?: OrganizationEntity;

  @OneToMany('KnowledgeDocumentEntity', (doc: KnowledgeDocumentEntity) => doc.knowledgeBase)
  documents?: KnowledgeDocumentEntity[];
}
