import type { AIResponseState } from '../../common/constants';

/**
 * Chat completion provider (docs/ARCHITECTURE.md §6.1).
 *
 * Deliberately separate from EmbeddingProvider: the Anthropic API has no
 * embeddings endpoint, so a single fused interface would be unimplementable
 * by the chat provider on day one (TD-06). Nothing outside this directory
 * imports a vendor SDK.
 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool the model may call, as advertised to it. */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** A call the model asked for. */
export interface LLMToolCall {
  /** Provider-assigned id, echoed back with the result. */
  id: string;
  name: string;
  input: unknown;
}

/** A result handed back so the model can continue the turn. */
export interface LLMToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/**
 * One turn of the conversation as the provider sees it.
 *
 * Tool exchanges are carried as opaque `providerMessages` rather than
 * flattened into text: Anthropic requires the original `tool_use` blocks to
 * be replayed verbatim, and reconstructing them from strings loses the ids
 * that pair a result with its call.
 */
export interface LLMInput {
  model: string;
  system: string;
  messages: LLMMessage[];
  maxTokens: number;
  effort?: string;
  tools?: LLMToolDefinition[];
  /** Opaque provider-native history from a previous tool round. */
  providerMessages?: unknown[];
  toolResults?: LLMToolResult[];
}

/**
 * The validated shape the model must return.
 *
 * `message` is the only field ever rendered to a human — which is what makes
 * §32's "never expose internal reasoning" true by construction rather than by
 * discipline.
 */
export interface LLMStructuredResponse {
  state: AIResponseState;
  message: string;
  handoffReason?: string;
  confidence?: number;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResponse {
  parsed: LLMStructuredResponse | null;
  /** Raw text, for diagnostics when parsing fails. Never shown to a customer. */
  rawText: string | null;
  stopReason: string | null;
  usage: LLMUsage;
  latencyMs: number;
  model: string;
  /** Present when the model asked to call tools instead of answering. */
  toolCalls?: LLMToolCall[];
  /** Provider-native messages to replay on the next round. */
  providerMessages?: unknown[];
}

export interface LLMProvider {
  readonly id: string;
  /** False when the provider cannot do tool calling at all. */
  readonly supportsTools: boolean;
  /** True when the provider is configured well enough to serve traffic. */
  isReady(): boolean;
  generateResponse(input: LLMInput): Promise<LLMResponse>;
  /** USD estimate for a request. Used by AI cost tracking (§44). */
  estimateCostUsd(model: string, usage: LLMUsage): number;
}
