import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { MessageSenderType, MessageType } from '../../common/constants';
import type { ConversationEntity } from './conversation.entity';
import type { MessageAttachmentEntity } from './message-attachment.entity';

/**
 * Does not extend TenantEntity: messages are append-only and have no
 * meaningful `updated_at`. `organizationId` is still carried on the row
 * itself (TD-05) so isolation never depends on a join.
 */
@Entity({ name: 'messages' })
@Index('ix_msg_conv_created', ['conversationId', 'createdAt'])
@Index('ix_msg_org_created', ['organizationId', 'createdAt'])
export class MessageEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({
    name: 'sender_type',
    type: 'enum',
    enum: MessageSenderType,
    enumName: 'message_sender_type',
  })
  senderType!: MessageSenderType;

  /**
   * Points at `users` or `customers` depending on senderType. Deliberately
   * not a foreign key — a polymorphic FK isn't expressible, and two nullable
   * columns would be noise for a field only ever read for display.
   */
  @Column({ name: 'sender_id', type: 'uuid', nullable: true })
  senderId!: string | null;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  @Column({ type: 'enum', enum: MessageType, enumName: 'message_type', default: MessageType.Text })
  type!: MessageType;

  /**
   * The customer message that caused this AI reply. Phase 3 uses it for
   * idempotency (TD-10); the partial unique index on it is what turns a
   * duplicated BullMQ job into a caught constraint violation rather than a
   * second reply the customer can see.
   */
  @Column({ name: 'trigger_message_id', type: 'uuid', nullable: true })
  triggerMessageId!: string | null;

  /**
   * The provider's own message id, for messages that arrived from an external
   * channel (Phase 8). A partial unique index on (organization_id,
   * external_id) is the inbound idempotency mechanism: providers retry a
   * webhook until they get a 200, and without it one customer message becomes
   * three and the AI answers three times.
   */
  @Column({ name: 'external_id', type: 'varchar', length: 200, nullable: true })
  externalId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('ConversationEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation?: ConversationEntity;

  @OneToMany('MessageAttachmentEntity', (a: MessageAttachmentEntity) => a.message)
  attachments?: MessageAttachmentEntity[];
}
