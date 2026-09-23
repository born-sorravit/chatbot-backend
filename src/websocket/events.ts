/**
 * WebSocket event vocabulary (docs/API.md §7).
 *
 * Two namespaces, because the two audiences hold different credentials and
 * must see different data (TD-11). Room membership *is* the authorization
 * boundary for broadcasts — nothing is emitted to a raw socket id.
 */
export const WS_NAMESPACE = {
  admin: '/ws/admin',
  customer: '/ws/customer',
} as const;

export const ServerEvent = {
  ConversationNew: 'conversation:new',
  ConversationUpdated: 'conversation:updated',
  MessageNew: 'message:new',
  MessageRead: 'message:read',
  TypingStart: 'typing:start',
  TypingStop: 'typing:stop',
  // Emitted from Phase 3 onward; listed here so the vocabulary lives in one file.
  AiThinking: 'ai:thinking',
  AiCompleted: 'ai:completed',
  AiHandoff: 'ai:handoff',
  NotificationNew: 'notification:new',
} as const;

export const ClientEvent = {
  ConversationSubscribe: 'conversation:subscribe',
  ConversationUnsubscribe: 'conversation:unsubscribe',
  TypingStart: 'typing:start',
  TypingStop: 'typing:stop',
  MessageRead: 'message:read',
} as const;

export const room = {
  organization: (organizationId: string) => `org:${organizationId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  user: (userId: string) => `user:${userId}`,
} as const;

export type TypingActor = 'CUSTOMER' | 'ADMIN';
