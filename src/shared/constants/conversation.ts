/** Mirrors the PG enums created in migration 001 (docs/DATABASE.md §2). */

export enum ConversationStatus {
  Open = 'OPEN',
  Pending = 'PENDING',
  Closed = 'CLOSED',
}

export enum ConversationMode {
  Ai = 'AI',
  Human = 'HUMAN',
}

export enum MessageSenderType {
  Customer = 'CUSTOMER',
  Ai = 'AI',
  Admin = 'ADMIN',
  System = 'SYSTEM',
}

export enum MessageType {
  Text = 'TEXT',
  Image = 'IMAGE',
  File = 'FILE',
  System = 'SYSTEM',
}

export enum HandoffReason {
  CustomerRequested = 'CUSTOMER_REQUESTED',
  AiCannotAnswer = 'AI_CANNOT_ANSWER',
  NoKnowledgeFound = 'NO_KNOWLEDGE_FOUND',
  ToolError = 'TOOL_ERROR',
  ProviderError = 'PROVIDER_ERROR',
  SensitiveTopic = 'SENSITIVE_TOPIC',
  BusinessRule = 'BUSINESS_RULE',
  ManualTakeover = 'MANUAL_TAKEOVER',
}

// The channel a conversation arrived on now lives in ./channels.ts, where
// Phase 8 added the external ones alongside it.
