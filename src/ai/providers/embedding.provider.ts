/**
 * Text → vector provider (docs/ARCHITECTURE.md §6.1, TD-06).
 *
 * Separate from LLMProvider on purpose: the Anthropic API has no embeddings
 * endpoint, so a single fused interface would be unimplementable by the chat
 * provider. Chat and embedding models are also chosen, priced and versioned
 * independently.
 */
export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/**
 * Retrieval quality improves measurably when query and document embeddings
 * are asymmetric. Providers that do not distinguish simply ignore this.
 */
export type EmbeddingKind = 'document' | 'query';

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  /** Must equal EMBEDDING_DIMENSIONS; asserted at boot. */
  readonly dimensions: number;
  /**
   * Cosine distance above which a chunk counts as irrelevant.
   *
   * Lives on the provider because it is a property of the embedding model,
   * not of the application: hashed n-grams and a trained encoder spread
   * distances completely differently, and a single hardcoded number is
   * therefore either too tight for one or too loose for the other. Measured
   * per provider; `RAG_MAX_DISTANCE` overrides it when set.
   */
  readonly defaultMaxDistance: number;
  /** True when the provider is configured well enough to serve traffic. */
  isReady(): boolean;
  embedOne(text: string, kind: EmbeddingKind): Promise<number[]>;
  /**
   * Batched embedding.
   *
   * Not a convenience wrapper: providers are rate-limited per request, so
   * ingesting a 200-chunk document as 200 calls is the difference between a
   * working pipeline and a throttled one.
   */
  embedMany(texts: string[], kind: EmbeddingKind): Promise<number[][]>;
  estimateCostUsd(tokenCount: number): number;
}
