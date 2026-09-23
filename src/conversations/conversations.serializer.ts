import type { ConversationEntity, MessageEntity, UserEntity } from '../database/entities';

/** Admin-facing projections (docs/API.md §3). */

function assignedUserView(user: UserEntity | null | undefined) {
  return user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl } : null;
}

export function toInboxItem(conversation: ConversationEntity, lastMessage?: MessageEntity | null) {
  return {
    id: conversation.id,
    customer: conversation.customer
      ? {
          id: conversation.customer.id,
          name: conversation.customer.name,
          email: conversation.customer.email,
          avatarUrl: conversation.customer.avatarUrl,
        }
      : null,
    status: conversation.status,
    mode: conversation.mode,
    channel: conversation.channel,
    assignedUser: assignedUserView(conversation.assignedUser),
    lastMessage: lastMessage
      ? {
          content: lastMessage.content,
          senderType: lastMessage.senderType,
          type: lastMessage.type,
          createdAt: lastMessage.createdAt.toISOString(),
        }
      : null,
    // The admin's badge, from the denormalized counter — never a COUNT(*).
    unreadCount: conversation.unreadAdminCount,
    handoffReason: conversation.handoffReason,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
  };
}

export function toConversationDetail(conversation: ConversationEntity) {
  return {
    ...toInboxItem(conversation),
    summary: conversation.summary,
    aiAgentId: conversation.aiAgentId,
    handoffAt: conversation.handoffAt?.toISOString() ?? null,
    closedAt: conversation.closedAt?.toISOString() ?? null,
    customer: conversation.customer
      ? {
          id: conversation.customer.id,
          name: conversation.customer.name,
          email: conversation.customer.email,
          phone: conversation.customer.phone,
          avatarUrl: conversation.customer.avatarUrl,
          tags: conversation.customer.tags,
          notes: conversation.customer.notes,
          metadata: conversation.customer.metadata,
          createdAt: conversation.customer.createdAt.toISOString(),
        }
      : null,
  };
}

/**
 * Admin message view. Includes senderId and metadata, which the customer
 * projection omits — but still never carries AI reasoning, because the
 * orchestrator does not persist any (master plan §49.12).
 */
export function toAdminMessage(message: MessageEntity) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderType: message.senderType,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    metadata: message.metadata,
    readAt: message.readAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}
