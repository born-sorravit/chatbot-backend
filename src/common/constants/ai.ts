/**
 * AI-side constants (master plan §16, §32).
 */

/**
 * Structured state the model returns alongside its message.
 *
 * Never shown to a customer — it drives what the orchestrator does next
 * (§32 forbids exposing internal reasoning).
 */
export enum AIResponseState {
  Answered = 'ANSWERED',
  NeedMoreInformation = 'NEED_MORE_INFORMATION',
  ToolRequired = 'TOOL_REQUIRED',
  Handoff = 'HANDOFF',
}

/** Progress signals for the customer UI. An enum, never model-authored text. */
export enum AiThinkingStatus {
  Thinking = 'thinking',
  SearchingKnowledge = 'searching_knowledge',
  CheckingOrder = 'checking_order',
}

export const AI_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AI_EFFORT_LEVELS)[number];

/**
 * Models an agent may be configured with.
 *
 * An allowlist rather than a free-text field: a typo in an admin form would
 * otherwise take the AI offline for every customer (docs/API.md §5).
 */
export const ALLOWED_LLM_MODELS = [
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5',
] as const;
export type AllowedLlmModel = (typeof ALLOWED_LLM_MODELS)[number];

export const DEFAULT_LLM_MODEL: AllowedLlmModel = 'claude-opus-5';

/** Tone presets offered in the admin UI (§16). */
export const AI_TONES = ['friendly', 'professional', 'casual', 'formal'] as const;
export type AiTone = (typeof AI_TONES)[number];

/** Queue names (master plan §28). */
export const QUEUE = {
  AiResponse: 'ai-response',
  KnowledgeIngestion: 'knowledge-ingestion',
  Embedding: 'embedding',
  ConversationSummary: 'conversation-summary',
  Notification: 'notification',
  ChannelDelivery: 'channel-delivery',
} as const;

/**
 * Deterministic job id — the idempotency mechanism (docs/ARCHITECTURE.md TD-10).
 *
 * A duplicate enqueue (double-click, retried HTTP request, at-least-once
 * delivery) is dropped by BullMQ rather than producing a second reply the
 * customer can see. The partial unique index on `messages.trigger_message_id`
 * catches whatever escapes the dedup window.
 *
 * Hyphen, not colon: BullMQ 6 rejects a custom job id containing ':'
 * ("Custom Id cannot contain :"). The enqueue helper swallows errors so a
 * queue problem cannot fail a customer's send, which means a malformed id
 * would silently cost every AI reply — it only showed up in the logs.
 */
export const aiResponseJobId = (messageId: string): string => `ai-response-${messageId}`;

/**
 * Ingestion job id.
 *
 * Includes an attempt counter because re-indexing the *same* document is a
 * legitimate, repeatable action — unlike an AI reply, where a duplicate is a
 * bug. A fixed id would make the second "Re-index" click silently do nothing.
 */
export const ingestionJobId = (documentId: string, nonce: string | number): string =>
  `ingest-${documentId}-${nonce}`;
