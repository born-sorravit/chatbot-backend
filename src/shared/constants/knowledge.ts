/** Knowledge base constants (master plan §20–§23). */

export enum DocumentStatus {
  Pending = 'PENDING',
  Processing = 'PROCESSING',
  Ready = 'READY',
  Failed = 'FAILED',
}

/**
 * MVP source formats (§21).
 *
 * Capped deliberately — DOCX/XLSX/Notion are listed as future work, and
 * shipping unreachable enum values invites half-built code paths.
 */
export enum DocumentSource {
  Text = 'TEXT',
  Markdown = 'MARKDOWN',
  Faq = 'FAQ',
  Pdf = 'PDF',
  Url = 'URL',
}

/**
 * Embedding width, fixed at schema time (docs/ARCHITECTURE.md TD-07).
 *
 * This is the single source of truth: migration 008 creates `vector(1024)`
 * from it, and every provider asserts against it at boot. Changing it means
 * altering the column *and* re-embedding every chunk, so it is a deliberate
 * migration, never a config tweak.
 *
 * 1024 works across the providers we support: it is Voyage's default, and
 * OpenAI's text-embedding-3-* accept a `dimensions` parameter that can be set
 * to it. That compatibility is why this number was chosen.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/** Retrieval tuning (§22). */
export const RAG_DEFAULTS = {
  /** Rows pulled from the ANN scan before filtering. */
  candidateK: 20,
  /** Chunks actually handed to the model. */
  topK: 5,
  /**
   * Maximum cosine distance for a chunk to count as relevant.
   *
   * This threshold is what makes §23 enforceable. Without it, vector search
   * always returns *something* — the nearest chunk, however irrelevant — and
   * the model will dutifully answer from it. Retrieving nothing is a feature.
   */
  maxDistance: 0.55,
  chunkTokens: 800,
  chunkOverlap: 120,
} as const;
