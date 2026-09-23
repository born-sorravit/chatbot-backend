import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { TenantEntity } from './base.entity';
import {
  CHANNEL_WEB,
  ConversationMode,
  ConversationStatus,
  HandoffReason,
} from '../../common/constants';
import type { CustomerEntity } from './customer.entity';
import type { UserEntity } from './user.entity';
import type { MessageEntity } from './message.entity';

@Entity({ name: 'conversations' })
@Index('ix_conv_org_last', ['organizationId', 'lastMessageAt'])
@Index('ix_conv_org_status', ['organizationId', 'status', 'lastMessageAt'])
@Index('ix_conv_org_mode', ['organizationId', 'mode', 'lastMessageAt'])
export class ConversationEntity extends TenantEntity {
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId!: string;

  /** Set from Phase 3 onward; null for conversations created before AI existed. */
  @Column({ name: 'ai_agent_id', type: 'uuid', nullable: true })
  aiAgentId!: string | null;

  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId!: string | null;

  @Column({
    type: 'enum',
    enum: ConversationStatus,
    enumName: 'conversation_status',
    default: ConversationStatus.Open,
  })
  status!: ConversationStatus;

  /**
   * AI or HUMAN. In Phase 2 nothing sets AI behaviour yet, but the column
   * drives the admin inbox filters and is the switch Phase 3's worker reads
   * before replying (docs/ARCHITECTURE.md §6.4 step 2).
   */
  @Column({
    type: 'enum',
    enum: ConversationMode,
    enumName: 'conversation_mode',
    default: ConversationMode.Ai,
  })
  mode!: ConversationMode;

  /** 'web' throughout the MVP. Exists now so Phase 8 adds adapters, not a migration. */
  @Column({ type: 'varchar', length: 32, default: CHANNEL_WEB })
  channel!: string;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ name: 'summary_updated_at', type: 'timestamptz', nullable: true })
  summaryUpdatedAt!: Date | null;

  @Column({
    name: 'handoff_reason',
    type: 'enum',
    enum: HandoffReason,
    enumName: 'handoff_reason',
    nullable: true,
  })
  handoffReason!: HandoffReason | null;

  @Column({ name: 'handoff_at', type: 'timestamptz', nullable: true })
  handoffAt!: Date | null;

  /**
   * Denormalized counters. A per-conversation COUNT(*) on every inbox render
   * does not survive real traffic (docs/DATABASE.md §3.2).
   */
  @Column({ name: 'unread_admin_count', type: 'int', default: 0 })
  unreadAdminCount!: number;

  @Column({ name: 'unread_customer_count', type: 'int', default: 0 })
  unreadCustomerCount!: number;

  /** Denormalized so the inbox list sorts without touching `messages`. */
  @Column({ name: 'last_message_at', type: 'timestamptz', nullable: true })
  lastMessageAt!: Date | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @ManyToOne('CustomerEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'customer_id' })
  customer?: CustomerEntity;

  @ManyToOne('UserEntity', { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_user_id' })
  assignedUser?: UserEntity | null;

  @OneToMany('MessageEntity', (message: MessageEntity) => message.conversation)
  messages?: MessageEntity[];
}
