import type { ConversationEntity, MessageEntity } from '@/models/entities';
import { MessageSenderType } from '@/shared/constants';

/**
 * Customer-facing projections.
 *
 * A separate mapper rather than the admin DTO with fields deleted: deletion
 * by omission is how internals leak the moment someone adds a field
 * (docs/API.md §2).
 */

export interface CustomerMessageView {
  id: string;
  senderType: MessageSenderType;
  senderName: string | null;
  content: string | null;
  type: string;
  createdAt: string;
  clientMessageId?: string;
}

/** Shown to customers in place of the agent's configured name. */
export const AI_DISPLAY_NAME = 'AI Assistant';

export function toCustomerMessage(
  message: MessageEntity,
  senderName: string | null = null,
): CustomerMessageView {
  const clientMessageId = message.metadata?.clientMessageId;

  return {
    id: message.id,
    senderType: message.senderType,
    // Admin identity is reduced to a display name — never their email or id.
    // AI messages get a fixed label here rather than at each call site, so a
    // reloaded transcript matches what the live socket sent.
    senderName:
      senderName ?? (message.senderType === MessageSenderType.Ai ? AI_DISPLAY_NAME : null),
    content: message.content,
    type: message.type,
    createdAt: message.createdAt.toISOString(),
    ...(typeof clientMessageId === 'string' ? { clientMessageId } : {}),
  };
}

export interface CustomerConversationView {
  id: string;
  status: string;
  mode: string;
  unreadCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export function toCustomerConversation(
  conversation: ConversationEntity,
): CustomerConversationView {
  return {
    id: conversation.id,
    status: conversation.status,
    mode: conversation.mode,
    unreadCount: conversation.unreadCustomerCount,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
  };
}
