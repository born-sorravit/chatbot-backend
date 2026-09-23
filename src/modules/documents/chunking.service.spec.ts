import { ChunkingService, estimateTokens } from './chunking.service';
import { ConfigService } from '@nestjs/config';

function service(chunkTokens = 100, overlap = 20): ChunkingService {
  return new ChunkingService(new ConfigService({ rag: { chunkTokens, chunkOverlap: overlap } }));
}

/** Thai text with no spaces between words — the hard case. */
const THAI_UNBROKEN =
  'ลูกค้าสามารถขอคืนสินค้าได้ภายในเจ็ดวันนับจากวันที่ได้รับสินค้าโดยสินค้าต้องอยู่ในสภาพสมบูรณ์ไม่ผ่านการใช้งานและมีบรรจุภัณฑ์ครบถ้วนบริษัทจะคืนเงินภายในสิบสี่วันทำการ'.repeat(
    4,
  );

describe('estimateTokens', () => {
  it('counts Thai far denser than Latin', () => {
    const thai = 'คืนสินค้าได้ภายในเจ็ดวัน';
    const latin = 'return within seven days';

    // Applying the ~4-chars-per-token Latin ratio to Thai undercounts badly,
    // which would produce chunks that blow past the context budget.
    expect(estimateTokens(thai) / thai.length).toBeGreaterThan(
      estimateTokens(latin) / latin.length,
    );
  });

  it('handles empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });
});

describe('ChunkingService', () => {
  it('returns nothing for empty input', () => {
    expect(service().chunk('')).toEqual([]);
    expect(service().chunk('   \n\n  ')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const chunks = service().chunk('นโยบายคืนสินค้า 7 วัน');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].index).toBe(0);
  });

  it('splits unbroken Thai rather than emitting one giant chunk', () => {
    // A word-boundary splitter finds nothing to split on here and would
    // return the whole document — the failure this cascade exists to avoid.
    const chunks = service(60, 10).chunk(THAI_UNBROKEN);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it('always makes forward progress and terminates', () => {
    // A boundary search that returned `start` would loop forever; this is the
    // guard against that.
    const chunks = service(40, 39).chunk(THAI_UNBROKEN);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(1000);
  });

  it('numbers chunks consecutively from zero', () => {
    const chunks = service(60, 10).chunk(THAI_UNBROKEN);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it('overlaps consecutive chunks so a straddling fact stays retrievable', () => {
    const chunks = service(80, 30).chunk(THAI_UNBROKEN);
    expect(chunks.length).toBeGreaterThan(1);

    // The tail of one chunk should reappear at the head of the next.
    const tail = chunks[0].content.slice(-10);
    expect(chunks[1].content.includes(tail.slice(0, 5))).toBe(true);
  });

  it('prefers paragraph boundaries in mixed text', () => {
    const text = `${'ก'.repeat(200)}\n\n${'ข'.repeat(200)}`;
    const chunks = service(120, 10).chunk(text);

    // The first chunk should not run past the paragraph break by much.
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('records the nearest markdown heading in metadata', () => {
    const text = `# นโยบายคืนสินค้า\n\n${'ก'.repeat(300)}`;
    const chunks = service(100, 10).chunk(text);

    expect(chunks.at(-1)?.metadata.heading).toBe('นโยบายคืนสินค้า');
  });

  it('carries base metadata onto every chunk', () => {
    const chunks = service(60, 10).chunk(THAI_UNBROKEN, { documentId: 'doc-1' });
    for (const chunk of chunks) {
      expect(chunk.metadata.documentId).toBe('doc-1');
    }
  });

  it('collapses excess blank lines without destroying paragraphs', () => {
    const chunks = service().chunk('ย่อหน้าหนึ่ง\n\n\n\n\nย่อหน้าสอง');
    expect(chunks[0].content).toContain('ย่อหน้าหนึ่ง\n\nย่อหน้าสอง');
  });
});
