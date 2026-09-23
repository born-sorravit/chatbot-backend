import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import type { MessageEntity } from './message.entity';

/**
 * Chat attachment metadata.
 *
 * The table ships with Phase 2's migration because `messages` cascades to it
 * and retrofitting that later means touching a large table. The upload
 * endpoint itself is not built yet — see the Phase 2 summary.
 *
 * `storageKey` is an object key, never a public URL: clients receive
 * short-lived signed URLs, so revoking access means not signing rather than
 * chasing a leaked link.
 */
@Entity({ name: 'message_attachments' })
export class MessageAttachmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId!: string;

  @Column({ name: 'storage_key', type: 'text' })
  storageKey!: string;

  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName!: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 127 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: string;

  @Column({ type: 'int', nullable: true })
  width!: number | null;

  @Column({ type: 'int', nullable: true })
  height!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne('MessageEntity', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'message_id' })
  message?: MessageEntity;
}
