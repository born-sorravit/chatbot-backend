import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../../config';
import { EMBEDDING_DIMENSIONS } from '../../common/constants';
import type { EmbeddingKind, EmbeddingProvider } from './embedding.provider';

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  usage?: { total_tokens: number };
}

/** USD per million tokens. An estimate for ai_usage_logs, never for billing. */
const PRICE_PER_MTOK = 0.06;

/**
 * Voyage AI embeddings — Anthropic's recommended embedding partner, which
 * keeps the chat and embedding vendors coherent.
 *
 * Raw fetch rather than the `voyageai` SDK: the request is one POST with four
 * fields, and a thin call keeps the vendor surface inside this file, which is
 * the whole point of the provider abstraction.
 *
 * **Unverified against the live API** — no key was available while building.
 * The request shape follows Voyage's documented `/v1/embeddings` contract.
 */
@Injectable()
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'voyage';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  /** Trained embeddings cluster far more tightly than hashed n-grams. */
  readonly defaultMaxDistance = 0.55;

  private readonly logger = new Logger(VoyageEmbeddingProvider.name);
  private readonly apiKey: string | undefined;

  constructor(private readonly config: AppConfig) {
    this.apiKey = this.config.embeddingApiKey;

    if (!this.apiKey) {
      this.logger.warn('EMBEDDING_API_KEY is not set — the Voyage provider is inactive');
    }
  }

  get model(): string {
    return this.config.embeddingModel;
  }

  isReady(): boolean {
    return Boolean(this.apiKey);
  }

  async embedOne(text: string, kind: EmbeddingKind): Promise<number[]> {
    const [vector] = await this.embedMany([text], kind);
    return vector;
  }

  async embedMany(texts: string[], kind: EmbeddingKind): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error('Voyage provider is not configured (EMBEDDING_API_KEY missing)');
    }

    if (texts.length === 0) {
      return [];
    }

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        // Asymmetric encoding: queries and documents are embedded differently,
        // which measurably improves retrieval.
        input_type: kind,
        output_dimension: this.dimensions,
      }),
      signal: AbortSignal.timeout(this.config.llmTimeoutMs),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Voyage embeddings failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const payload = (await response.json()) as VoyageResponse;

    // The API does not promise ordering, so results are placed by index.
    const ordered = new Array<number[]>(texts.length);
    for (const item of payload.data) {
      ordered[item.index] = item.embedding;
    }

    for (const [index, vector] of ordered.entries()) {
      if (!vector) {
        throw new Error(`Voyage returned no embedding for input ${index}`);
      }
      if (vector.length !== this.dimensions) {
        // Fail loudly: a wrong width silently writes vectors that can never
        // match anything (docs/ARCHITECTURE.md TD-07).
        throw new Error(
          `Voyage returned ${vector.length} dimensions, expected ${this.dimensions}`,
        );
      }
    }

    return ordered;
  }

  estimateCostUsd(tokenCount: number): number {
    return (tokenCount / 1_000_000) * PRICE_PER_MTOK;
  }
}
