import { Injectable, Logger } from '@nestjs/common';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { DocumentSource } from '@/shared/constants';

export interface ExtractionInput {
  sourceType: DocumentSource;
  /** Inline text for TEXT / MARKDOWN / FAQ. */
  content?: string | null;
  /** Page to fetch for URL. */
  sourceUrl?: string | null;
  /** Raw bytes for PDF. */
  buffer?: Buffer | null;
}

export interface ExtractionResult {
  text: string;
  metadata: Record<string, unknown>;
}

/** A page that takes longer than this is not worth blocking an ingest job on. */
const URL_FETCH_TIMEOUT_MS = 15_000;
const MAX_REMOTE_BYTES = 5 * 1024 * 1024;

/**
 * Turns a source into plain text (master plan §21, §22).
 *
 * Every failure here is a message an admin will read in the UI, so the errors
 * say what to do about it rather than surfacing a library's wording.
 */
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    switch (input.sourceType) {
      case DocumentSource.Text:
      case DocumentSource.Markdown:
        return this.fromInline(input.content);

      case DocumentSource.Faq:
        return this.fromFaq(input.content);

      case DocumentSource.Pdf:
        return this.fromPdf(input.buffer);

      case DocumentSource.Url:
        return this.fromUrl(input.sourceUrl);
    }
  }

  private fromInline(content: string | null | undefined): ExtractionResult {
    const text = (content ?? '').trim();

    if (!text) {
      throw new Error('เอกสารว่างเปล่า — กรุณาใส่เนื้อหา');
    }

    return { text, metadata: {} };
  }

  /**
   * FAQ text.
   *
   * Q/A pairs are normalised into "คำถาม / คำตอบ" blocks separated by blank
   * lines, so the chunker's paragraph boundary keeps each pair intact. A
   * question split away from its answer retrieves as a question with no
   * answer, which is worse than not indexing it.
   */
  private fromFaq(content: string | null | undefined): ExtractionResult {
    const raw = (content ?? '').trim();

    if (!raw) {
      throw new Error('FAQ ว่างเปล่า — กรุณาใส่คำถามและคำตอบ');
    }

    const lines = raw.split('\n');
    const blocks: string[] = [];
    let current: string[] = [];

    const isQuestion = (line: string) =>
      /^\s*(q[:.)]|question[:.]|ถาม[:.]|คำถาม[:.]|-\s*q[:.])/i.test(line);

    for (const line of lines) {
      if (isQuestion(line) && current.length > 0) {
        blocks.push(current.join('\n').trim());
        current = [];
      }
      current.push(line);
    }

    if (current.length > 0) {
      blocks.push(current.join('\n').trim());
    }

    const pairs = blocks.filter(Boolean);

    return {
      text: pairs.join('\n\n'),
      metadata: { faqPairs: pairs.length },
    };
  }

  private async fromPdf(buffer: Buffer | null | undefined): Promise<ExtractionResult> {
    if (!buffer || buffer.length === 0) {
      throw new Error('ไม่พบไฟล์ PDF');
    }

    // Imported lazily: pdfjs pulls in a large dependency tree, and an API
    // process that never ingests a PDF should not pay for it at boot.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const result = await parser.getText();
      const text = result.text.trim();

      if (!text) {
        // The single most common PDF failure, and the admin can act on it.
        throw new Error(
          'ไม่พบข้อความใน PDF — ไฟล์นี้อาจเป็นภาพสแกน กรุณาแปลงเป็นข้อความก่อน (OCR)',
        );
      }

      return { text, metadata: { pageCount: result.total } };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  }

  private async fromUrl(url: string | null | undefined): Promise<ExtractionResult> {
    if (!url) {
      throw new Error('ไม่พบ URL');
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('URL ไม่ถูกต้อง');
    }

    // Only http(s). Without this, file:// would let an admin read the
    // server's own filesystem into a knowledge base.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('รองรับเฉพาะ URL ที่ขึ้นต้นด้วย http:// หรือ https://');
    }

    const response = await fetch(parsed.toString(), {
      signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': 'chatbots-kb-ingest/1.0' },
      redirect: 'follow',
    }).catch(() => {
      throw new Error('ดึงข้อมูลจาก URL ไม่สำเร็จ');
    });

    if (!response.ok) {
      throw new Error(`ดึงข้อมูลจาก URL ไม่สำเร็จ (HTTP ${response.status})`);
    }

    const html = await response.text();

    if (html.length > MAX_REMOTE_BYTES) {
      throw new Error('หน้าเว็บมีขนาดใหญ่เกินไป');
    }

    const dom = new JSDOM(html, { url: parsed.toString() });
    const article = new Readability(dom.window.document).parse();

    // Readability strips navigation, ads and boilerplate. Falling back to raw
    // body text keeps a page usable when it is not article-shaped.
    const text = (article?.textContent ?? dom.window.document.body?.textContent ?? '').trim();

    if (!text) {
      throw new Error('ไม่พบเนื้อหาที่อ่านได้ในหน้าเว็บนี้');
    }

    this.logger.log({ event: 'kb.url_extracted', url: parsed.hostname, length: text.length });

    return {
      text,
      metadata: { sourceUrl: parsed.toString(), title: article?.title ?? null },
    };
  }
}
