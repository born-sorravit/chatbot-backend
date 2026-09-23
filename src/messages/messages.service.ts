import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConversationEntity, MessageEntity } from '../database/entities';
import { MessagesRepository } from './messages.repository';
import {
  ConversationStatus,
  MessageSenderType,
  MessageType,
  isExternalChannel,
} from '../common/constants';
import { ChannelDeliveryQueue } from '../queue/channel-delivery.queue';

export interface CreateMessageInput {
  organizationId: string;
  conversationId: string;
  senderType: MessageSenderType;
  senderId?: string | null;
  content: string;
  type?: MessageType;
  metadata?: Record<string, unknown>;
  triggerMessageId?: string | null;
  /**
   * The provider's message id, for inbound external-channel messages.
   *
   * Carries the partial unique index that makes a retried webhook a caught
   * constraint violation instead of a duplicate message (Phase 8).
   */
  externalId?: string | null;
  /**
   * Conversation fields to change in the *same* transaction as the insert.
   *
   * Exists for takeover-on-reply: an admin message must not be able to land
   * in a conversation still marked AI. Applied under the same row lock, so
   * there is no window where the two disagree — which matters in Phase 3,
   * where an in-flight AI job re-reads `mode` before replying (R-03).
   */
  conversationPatch?: Partial<
    Pick<
      ConversationEntity,
      'mode' | 'status' | 'assignedUserId' | 'handoffReason' | 'handoffAt'
    >
  >;
}

export interface CreatedMessage {
  message: MessageEntity;
  conversation: ConversationEntity;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly messages: MessagesRepository,
    private readonly delivery: ChannelDeliveryQueue,
  ) {}

  /**
   * The single write path for every message, whoever sends it.
   *
   * Message insert and conversation bookkeeping (`last_message_at`, unread
   * counters, reopen-on-reply) happen in one transaction. Split apart, a
   * crash between them leaves the inbox sorting on a stale timestamp or
   * showing an unread badge for a message that was never stored.
   */
  async create(input: CreateMessageInput): Promise<CreatedMessage> {
    const created = await this.write(input);
    await this.dispatchToChannel(created);
    return created;
  }

  /**
   * Pushes an outbound message to the customer's external channel.
   *
   * Deliberately here rather than at each call site. Every reply — AI,
   * admin, takeover notice — already funnels through `create()`, so hooking
   * it once means a future call site cannot forget to deliver, which for a
   * LINE customer would look like the business silently ignoring them.
   *
   * After the commit, never inside it: enqueueing within the transaction
   * would let a job fire for a write that then rolls back, and the worker
   * would find no message. `enqueue` swallows its own errors for the same
   * reason the AI queue does.
   *
   * SYSTEM messages are deliberately not delivered. They are third-person
   * timeline entries for the inbox — "X took over from AI" — and a provider
   * has no system-message affordance, so pushing one would reach the customer
   * as though the business had typed it. The consequence is a real and
   * intended difference: a web customer sees the takeover notice in the
   * widget, a LINE customer sees nothing until the agent actually writes.
   * The AI's own handoff line is sender AI, so that one *is* delivered.
   */
  private async dispatchToChannel({ message, conversation }: CreatedMessage): Promise<void> {
    const outbound =
      message.senderType === MessageSenderType.Ai ||
      message.senderType === MessageSenderType.Admin;

    if (!outbound || !isExternalChannel(conversation.channel) || !message.content) {
      return;
    }

    await this.delivery.enqueue({
      organizationId: message.organizationId,
      conversationId: conversation.id,
      messageId: message.id,
    });
  }

  private async write(input: CreateMessageInput): Promise<CreatedMessage> {
    return this.dataSource.transaction(async (manager) => {
      const conversations = manager.getRepository(ConversationEntity);
      const messages = manager.getRepository(MessageEntity);

      // Locked for the duration so two concurrent messages cannot both read
      // the same counter and each write back the same +1.
      const conversation = await conversations.findOne({
        where: { id: input.conversationId, organizationId: input.organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!conversation) {
        throw new NotFoundException({
          code: 'CONVERSATION_NOT_FOUND',
          message: 'Conversation not found',
        });
      }

      const message = await messages.save(
        messages.create({
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          senderType: input.senderType,
          senderId: input.senderId ?? null,
          content: input.content,
          type: input.type ?? MessageType.Text,
          metadata: input.metadata ?? {},
          triggerMessageId: input.triggerMessageId ?? null,
          externalId: input.externalId ?? null,
        }),
      );

      conversation.lastMessageAt = message.createdAt;

      // Unread accrues for whoever did NOT send. SYSTEM messages are
      // bookkeeping, not something either side needs to be notified about.
      if (input.senderType === MessageSenderType.Customer) {
        conversation.unreadAdminCount += 1;
      } else if (
        input.senderType === MessageSenderType.Admin ||
        input.senderType === MessageSenderType.Ai
      ) {
        conversation.unreadCustomerCount += 1;
      }

      // A reply to a closed conversation reopens it — otherwise the message
      // lands somewhere nobody is looking.
      if (conversation.status === ConversationStatus.Closed) {
        conversation.status = ConversationStatus.Open;
        conversation.closedAt = null;
      }

      if (input.conversationPatch) {
        Object.assign(conversation, input.conversationPatch);
      }

      await conversations.save(conversation);

      return { message, conversation };
    });
  }

  async list(organizationId: string, conversationId: string, before: string | undefined, limit: number) {
    return this.messages.listByConversation(organizationId, conversationId, { before, limit });
  }

  /**
   * Marks the reader's side caught up.
   *
   * Only the counter is reset. Per-message `read_at` is set for the other
   * party's messages so a future read-receipt feature has the data, but the
   * badge itself reads the denormalized counter.
   */
  async markRead(
    organizationId: string,
    conversationId: string,
    reader: 'admin' | 'customer',
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const senderTypes =
        reader === 'admin'
          ? [MessageSenderType.Customer]
          : [MessageSenderType.Admin, MessageSenderType.Ai];

      await manager
        .createQueryBuilder()
        .update(MessageEntity)
        .set({ readAt: () => 'now()' })
        .where('organization_id = :organizationId', { organizationId })
        .andWhere('conversation_id = :conversationId', { conversationId })
        .andWhere('sender_type IN (:...senderTypes)', { senderTypes })
        .andWhere('read_at IS NULL')
        .execute();

      await manager
        .createQueryBuilder()
        .update(ConversationEntity)
        .set(
          reader === 'admin' ? { unreadAdminCount: 0 } : { unreadCustomerCount: 0 },
        )
        .where('id = :conversationId', { conversationId })
        .andWhere('organization_id = :organizationId', { organizationId })
        .execute();
    });
  }
}
