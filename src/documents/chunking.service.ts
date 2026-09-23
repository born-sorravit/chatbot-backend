import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config';

export interface Chunk {
  content: string;
  index: number;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

/**
 * Rough token estimate.
 *
 * ~4 characters per token for Latin script, but Thai is far denser — roughly
 * one token per 1.5 characters with most tokenizers. Using the Latin ratio on
 * Thai would undercount by 2-3x and produce chunks that blow past the context
 * budget. Detecting the script and estimating per-segment is cheap and much
 * closer than a single global divisor.
 */
export function estimateTokens(text: string): number {
  let thai = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 0x0e00 && code <= 0x0e7f) {
      thai += 1;
    }
  }
  const other = text.length - thai;
  return Math.ceil(thai / 1.5 + other / 4);
}

@Injectable()
export class ChunkingService {
  constructor(private readonly config: AppConfig) {}

  /**
   * Splits text into overlapping chunks (master plan §22).
   *
   * Boundary preference: headings → blank lines → sentence ends → any
   * whitespace → hard character cut. The cascade matters because **Thai has
   * no spaces between words**: a word-boundary splitter finds nothing to split
   * on and either emits the whole document as one chunk or cuts mid-syllable.
   * Thai does use spaces between phrases, so whitespace is still a useful
   * signal — just not a reliable one, which is why the hard cut exists as the
   * final fallback.
   */
  chunk(text: string, baseMetadata: Record<string, unknown> = {}): Chunk[] {
    const cleaned = this.clean(text);

    if (!cleaned) {
      return [];
    }

    const maxTokens = this.config.ragChunkTokens;
    const overlapTokens = this.config.ragChunkOverlap;

    // Work in characters, converted from the token budget via the same
    // estimator, so a Thai document gets proportionally smaller windows.
    const ratio = cleaned.length / Math.max(estimateTokens(cleaned), 1);
    const maxChars = Math.max(Math.floor(maxTokens * ratio), 200);
    const overlapChars = Math.min(Math.floor(overlapTokens * ratio), Math.floor(maxChars / 2));

    const chunks: Chunk[] = [];
    let start = 0;
    let index = 0;

    while (start < cleaned.length) {
      const hardEnd = Math.min(start + maxChars, cleaned.length);
      const end = hardEnd === cleaned.length ? hardEnd : this.findBoundary(cleaned, start, hardEnd);
      const content = cleaned.slice(start, end).trim();

      if (content) {
        chunks.push({
          content,
          index,
          tokenCount: estimateTokens(content),
          metadata: { ...baseMetadata, heading: this.headingFor(cleaned, start) },
        });
        index += 1;
      }

      if (end >= cleaned.length) {
        break;
      }

      // Overlap keeps a fact that straddles a boundary retrievable from both
      // sides. `Math.max(..., start + 1)` guarantees forward progress even if
      // the boundary search returned something pathological.
      start = Math.max(end - overlapChars, start + 1);
    }

    return chunks;
  }

  /** Normalises whitespace without destroying paragraph structure. */
  private clean(text: string): string {
    return text
      .replace(/\r\n?/g, '\n')
      // Collapse runs of blank lines to exactly one, so paragraph detection
      // stays meaningful.
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .trim();
  }

  /**
   * Best split point in (start, hardEnd].
   *
   * Searches backwards from the hard limit so a chunk never exceeds the
   * budget, and only accepts a boundary in the last 40% of the window —
   * otherwise a single early newline would produce a tiny chunk and waste the
   * budget.
   */
  private findBoundary(text: string, start: number, hardEnd: number): number {
    const minAccepted = start + Math.floor((hardEnd - start) * 0.6);
    const window = text.slice(start, hardEnd);

    const patterns: RegExp[] = [
      /\n#{1,6} /g, // markdown heading
      /\n\n/g, // paragraph
      /[.!?।]\s/g, // sentence end (Latin)
      /[ๆฯ]\s|[。．]\s?/g, // Thai/CJK sentence-ish markers
      /\n/g, // any line break
      /\s/g, // any whitespace — Thai phrase boundaries land here
    ];

    for (const pattern of patterns) {
      let best = -1;
      for (const match of window.matchAll(pattern)) {
        const absolute = start + match.index + match[0].length;
        if (absolute > minAccepted && absolute <= hardEnd) {
          best = absolute;
        }
      }
      if (best > 0) {
        return best;
      }
    }

    // No boundary at all — unbroken Thai, a URL, a long table row. Cut hard
    // rather than emit an oversized chunk.
    return hardEnd;
  }

  /** Nearest preceding markdown heading, for chunk metadata. */
  private headingFor(text: string, position: number): string | null {
    const before = text.slice(0, position);
    const matches = [...before.matchAll(/^#{1,6} (.+)$/gm)];
    return matches.length > 0 ? (matches.at(-1)?.[1]?.trim() ?? null) : null;
  }
}
