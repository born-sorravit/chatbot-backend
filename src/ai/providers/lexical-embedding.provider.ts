import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '../../common/constants';
import type { EmbeddingKind, EmbeddingProvider } from './embedding.provider';

/** Character n-gram sizes. 2–4 covers Thai syllables and short English words. */
const NGRAM_SIZES = [2, 3, 4];

/**
 * Offline embedding provider using hashed character n-grams.
 *
 * **This is lexical, not semantic.** It matches on shared character sequences,
 * so "คืนสินค้าได้กี่วัน" retrieves a refund policy containing "คืนสินค้า" —
 * but it will not connect "ส่งของ" to "จัดส่ง" the way a trained model would.
 * Say so plainly rather than letting it be mistaken for semantic search.
 *
 * It exists because it makes the whole RAG pipeline — chunking, storage, the
 * pgvector HNSW index, cosine search, the distance threshold, prompt assembly —
 * real and testable with no API key, no network, no model download and no RAM
 * cost. Everything except the embedding function itself is the production path.
 *
 * Character n-grams rather than words is deliberate: Thai has no spaces
 * between words, so any word-boundary tokenizer would fail on the primary
 * language this product targets.
 *
 * Swap to Voyage or OpenAI for real semantics (both emit 1024 dimensions, so
 * the schema does not change) — but every stored chunk must be re-embedded,
 * because vectors from different models are not comparable.
 */
@Injectable()
export class LexicalEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'lexical';
  readonly model = 'hashed-char-ngrams';
  readonly dimensions = EMBEDDING_DIMENSIONS;

  /**
   * Measured, not guessed.
   *
   * Against a Thai FAQ set, correct matches landed at 0.44–0.69 while the
   * nearest irrelevant chunk sat at 0.88+. 0.80 splits that gap with room on
   * both sides. The 0.55 originally specified in the plan is tuned for
   * trained embeddings and silently rejects most correct hits here.
   */
  readonly defaultMaxDistance = 0.8;

  private readonly logger = new Logger(LexicalEmbeddingProvider.name);

  constructor() {
    this.logger.warn(
      'Using the LEXICAL embedding provider — retrieval matches shared character sequences, not meaning. ' +
        'Set EMBEDDING_PROVIDER=voyage|openai with a key for semantic search.',
    );
  }

  isReady(): boolean {
    return true;
  }

  async embedOne(text: string, _kind: EmbeddingKind): Promise<number[]> {
    return this.vectorize(text);
  }

  async embedMany(texts: string[], _kind: EmbeddingKind): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }

  /** Free — nothing leaves the process. */
  estimateCostUsd(): number {
    return 0;
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

    if (!normalized) {
      // A zero vector has undefined cosine distance, which pgvector reports as
      // NaN and which would sort unpredictably. Return a fixed unit vector.
      vector[0] = 1;
      return vector;
    }

    for (const size of NGRAM_SIZES) {
      for (let i = 0; i + size <= normalized.length; i += 1) {
        const gram = normalized.slice(i, i + size);
        const digest = createHash('md5').update(gram).digest();
        const bucket = digest.readUInt32BE(0) % this.dimensions;
        // Signed contribution, so unrelated n-grams cancel instead of making
        // every document drift toward the same direction.
        const sign = (digest[4] & 1) === 0 ? 1 : -1;
        vector[bucket] += sign;
      }
    }

    // L2-normalise: cosine distance assumes unit vectors, and without this a
    // long document would sit closer to everything simply for being long.
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

    if (magnitude === 0) {
      vector[0] = 1;
      return vector;
    }

    return vector.map((value) => value / magnitude);
  }
}
