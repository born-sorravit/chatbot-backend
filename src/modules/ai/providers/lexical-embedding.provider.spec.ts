import { LexicalEmbeddingProvider } from './lexical-embedding.provider';
import { EMBEDDING_DIMENSIONS } from '@/shared/constants';

const cosineDistance = (a: number[], b: number[]) =>
  1 - a.reduce((sum, value, index) => sum + value * b[index], 0);

describe('LexicalEmbeddingProvider', () => {
  const provider = new LexicalEmbeddingProvider();

  it('emits vectors of exactly the schema width', async () => {
    // A mismatch silently writes vectors that can never match anything.
    const vector = await provider.embedOne('ทดสอบ', 'document');
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('produces unit vectors, as cosine distance assumes', async () => {
    const vector = await provider.embedOne('นโยบายการคืนสินค้าภายใน 7 วัน', 'document');
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([
      provider.embedOne('คืนสินค้า', 'document'),
      provider.embedOne('คืนสินค้า', 'query'),
    ]);
    expect(a).toEqual(b);
  });

  it('handles empty text without producing a NaN-distance zero vector', async () => {
    const vector = await provider.embedOne('   ', 'document');
    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 5);
  });

  it('ranks a related Thai question nearest its own document', async () => {
    const docs = {
      refund: 'ลูกค้าสามารถขอคืนสินค้าได้ภายใน 7 วัน โดยสินค้าต้องอยู่ในสภาพสมบูรณ์',
      shipping: 'จัดส่งภายใน 3-5 วันทำการ ค่าจัดส่ง 50 บาท ทั่วประเทศ',
      warranty: 'รับประกัน 1 ปีเต็ม ครอบคลุมความเสียหายจากการผลิต',
    };

    const vectors = Object.fromEntries(
      await Promise.all(
        Object.entries(docs).map(async ([key, text]) => [
          key,
          await provider.embedOne(text, 'document'),
        ]),
      ),
    ) as Record<string, number[]>;

    const query = await provider.embedOne('คืนสินค้าได้ภายในกี่วัน', 'query');

    const ranked = Object.entries(vectors)
      .map(([key, vector]) => [key, cosineDistance(query, vector)] as const)
      .sort((a, b) => a[1] - b[1]);

    expect(ranked[0][0]).toBe('refund');
    expect(ranked[0][1]).toBeLessThanOrEqual(provider.defaultMaxDistance);
  });

  it('pushes an unrelated question past the relevance threshold', async () => {
    // This is what makes §23 enforceable: retrieving nothing is a feature.
    const doc = await provider.embedOne(
      'ลูกค้าสามารถขอคืนสินค้าได้ภายใน 7 วัน',
      'document',
    );
    const query = await provider.embedOne('โปรโมชั่นเดือนหน้ามีอะไรบ้าง', 'query');

    expect(cosineDistance(query, doc)).toBeGreaterThan(provider.defaultMaxDistance);
  });

  it('matches across scripts within a document', async () => {
    const doc = await provider.embedOne(
      'Refund policy: customers may return items within 7 days.',
      'document',
    );
    const query = await provider.embedOne('how many days to return', 'query');

    expect(cosineDistance(query, doc)).toBeLessThanOrEqual(provider.defaultMaxDistance);
  });
});
