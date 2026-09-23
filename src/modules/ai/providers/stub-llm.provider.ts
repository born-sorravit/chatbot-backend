import { Injectable, Logger } from '@nestjs/common';
import { AIResponseState } from '@/shared/constants';
import type { LLMInput, LLMProvider, LLMResponse, LLMUsage } from './llm.provider';

/**
 * Deterministic provider for local development and tests.
 *
 * This is not a mock bolted onto the tests — it is a real implementation of
 * `LLMProvider`, selected by `LLM_PROVIDER=stub`. It exists so the whole
 * pipeline (queue → worker → orchestrator → provider → message → WebSocket)
 * can be exercised and asserted without spending tokens or requiring a key,
 * and so CI is not gated on a live third-party API.
 *
 * It deliberately does NOT try to be clever. Its job is to return each
 * `AIResponseState` on demand so every branch of the orchestrator has a way
 * to be reached, which canned prose could not do.
 */
@Injectable()
export class StubLlmProvider implements LLMProvider {
  readonly id = 'stub';
  readonly supportsTools = true;
  private readonly logger = new Logger(StubLlmProvider.name);

  constructor() {
    this.logger.warn(
      'Using the STUB LLM provider — replies are canned. Set LLM_PROVIDER=anthropic and LLM_API_KEY for real responses.',
    );
  }

  isReady(): boolean {
    return true;
  }

  async generateResponse(input: LLMInput): Promise<LLMResponse> {
    const startedAt = Date.now();
    const lastUserMessage = [...input.messages].reverse().find((m) => m.role === 'user');
    const text = lastUserMessage?.content ?? '';
    const knowledge = this.readKnowledgeSection(input.system);

    // Simulated latency, so optimistic UI and "AI is thinking" states are
    // exercised rather than resolving instantly and hiding timing bugs.
    await new Promise((resolve) => setTimeout(resolve, 150));

    /**
     * Tool round.
     *
     * When tools are offered and the customer's text names something a tool
     * covers, request that tool instead of answering — then answer from the
     * result on the next round. This mirrors how a real model behaves closely
     * enough that the whole tool loop (permission check, validation, logging,
     * result-to-answer) is exercised and asserted without a key.
     */
    const toolCall = this.maybeCallTool(text, input);

    if (toolCall) {
      return {
        parsed: null,
        rawText: null,
        stopReason: 'tool_use',
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
        latencyMs: Date.now() - startedAt,
        model: `${input.model} (stub)`,
        toolCalls: [toolCall],
        providerMessages: [{ role: 'assistant', stubToolCall: toolCall }],
      };
    }

    const { state, message, handoffReason } = this.decide(text, knowledge, input.toolResults);

    const usage: LLMUsage = {
      inputTokens: Math.ceil(input.system.length / 4),
      outputTokens: Math.ceil(message.length / 4),
      totalTokens: Math.ceil((input.system.length + message.length) / 4),
    };

    return {
      parsed: { state, message, handoffReason, confidence: 0.9 },
      rawText: message,
      stopReason: 'end_turn',
      usage,
      latencyMs: Date.now() - startedAt,
      model: `${input.model} (stub)`,
    };
  }

  /**
   * Reads the retrieved excerpts back out of the assembled system prompt.
   *
   * A real model reads that section and answers from it; this reproduces that
   * behaviour so the Phase 4 acceptance criterion — "admin adds business
   * information and the AI answers from it" — is genuinely demonstrable
   * without a key, rather than asserted.
   */
  private readKnowledgeSection(system: string): {
    hasExcerpts: boolean;
    searchedAndEmpty: boolean;
    excerpts: string;
  } {
    const section = system.split('## Knowledge base')[1] ?? '';
    const body = section.split('\n## ')[0] ?? '';

    return {
      hasExcerpts: body.includes('### ['),
      searchedAndEmpty: body.includes('returned NO'),
      excerpts: body,
    };
  }

  /**
   * Picks a tool when the text clearly calls for one.
   *
   * Only on the first round — `toolResults` being present means a tool has
   * already run, and calling again would loop.
   */
  private maybeCallTool(
    text: string,
    input: LLMInput,
  ): { id: string; name: string; input: unknown } | null {
    if (!input.tools || input.tools.length === 0 || input.toolResults?.length) {
      return null;
    }

    const available = new Set(input.tools.map((tool) => tool.name));
    const lowered = text.toLowerCase();

    const orderMatch = /#?\s*(\d{3,})/.exec(text);
    if (
      available.has('getOrderStatus') &&
      orderMatch &&
      /order|คำสั่งซื้อ|เลขที่|พัสดุ|ส่งถึงไหน|ถึงไหน/i.test(text)
    ) {
      return { id: 'stub-tool-1', name: 'getOrderStatus', input: { orderId: orderMatch[1] } };
    }

    if (available.has('getProductStock') && /stock|มีของ|มีสินค้า|เหลือ|คงเหลือ/i.test(lowered)) {
      return {
        id: 'stub-tool-2',
        name: 'getProductStock',
        // Colour is deliberately left out of `query` and not mapped into
        // `variant`: the seeded attributes are in English ("black") while a
        // Thai customer says "สีดำ", so a literal variant filter would find
        // nothing. Returning every variant with its stock is both correct and
        // more useful. A real deployment would store localized attribute
        // values or add a mapping — see docs/ARCHITECTURE.md TD-37.
        input: { query: this.extractProductQuery(text) },
      };
    }

    if (available.has('getProduct') && /ราคา|price|กี่บาท|เท่าไหร่/i.test(lowered)) {
      return {
        id: 'stub-tool-3',
        name: 'getProduct',
        input: { query: this.extractProductQuery(text) },
      };
    }

    return null;
  }

  /**
   * Crude noun extraction — enough to drive the loop deterministically.
   *
   * Strips question words *and* colour words, so "iPhone 17 Pro สีดำ มีของไหม"
   * searches for the product rather than for a string no SKU contains.
   */
  private extractProductQuery(text: string): string {
    const cleaned = text
      .replace(/[?？#]/g, ' ')
      .replace(
        /(ราคา|price|กี่บาท|เท่าไหร่|มีของ|มีสินค้า|เหลือ|คงเหลือ|stock|ไหม|ครับ|ค่ะ|คะ|อยาก|สอบถาม)/gi,
        ' ',
      )
      .replace(/สี(ดำ|ขาว|แดง|น้ำเงิน|เขียว|ทอง|เงิน|ชมพู|ม่วง|เทา)/g, ' ')
      .replace(/\b(black|white|red|blue|green|gold|silver|pink|purple|grey|gray)\b/gi, ' ')
      .trim();

    return cleaned.split(/\s+/).filter(Boolean).slice(0, 4).join(' ') || text.slice(0, 40);
  }

  /** Keyword triggers so tests can reach each branch deterministically. */
  private decide(
    text: string,
    knowledge: { hasExcerpts: boolean; searchedAndEmpty: boolean; excerpts: string },
    toolResults?: { content: string; isError?: boolean }[],
  ): {
    state: AIResponseState;
    message: string;
    handoffReason?: string;
  } {
    const lowered = text.toLowerCase();

    // An explicit request for a person beats everything, including knowledge.
    if (
      lowered.includes('พนักงาน') ||
      lowered.includes('human') ||
      lowered.includes('agent')
    ) {
      return {
        state: AIResponseState.Handoff,
        message: 'ขอส่งต่อให้ทีมงานดูแลต่อนะครับ สักครู่ครับ',
        handoffReason: 'Customer asked for a human',
      };
    }

    /**
     * A tool ran — answer strictly from its result.
     *
     * §26: the AI must use the tool output and never guess a status. Echoing
     * the payload is what lets a test assert the answer really came from the
     * tool rather than from the model's priors.
     */
    if (toolResults && toolResults.length > 0) {
      const first = toolResults[0];

      if (first.isError) {
        return {
          state: AIResponseState.Handoff,
          message: 'ขออภัยครับ ผมดึงข้อมูลไม่สำเร็จ ขอส่งต่อให้ทีมงานตรวจสอบให้นะครับ',
          handoffReason: 'Tool execution failed',
        };
      }

      return {
        state: AIResponseState.Answered,
        message: `จากระบบครับ: ${first.content.slice(0, 500)}`,
      };
    }

    // Knowledge was retrieved — answer from it, quoting the first excerpt.
    if (knowledge.hasExcerpts) {
      const firstExcerpt = knowledge.excerpts
        .split('### [')[1]
        ?.split('\n')
        .slice(1)
        .join(' ')
        .trim();

      return {
        state: AIResponseState.Answered,
        message: `จากข้อมูลของเราครับ: ${(firstExcerpt ?? '').slice(0, 400)}`,
      };
    }

    // Searched and found nothing — the §23 path. Never invent an answer.
    if (knowledge.searchedAndEmpty) {
      return {
        state: AIResponseState.Handoff,
        message: 'ขออภัยครับ ผมไม่มีข้อมูลเรื่องนี้ ขอส่งต่อให้ทีมงานตรวจสอบให้นะครับ',
        handoffReason: 'Knowledge base search returned nothing relevant',
      };
    }

    if (lowered.includes('?') || lowered.includes('ไหม') || lowered.includes('อะไร')) {
      return {
        state: AIResponseState.NeedMoreInformation,
        message: 'รบกวนขอรายละเอียดเพิ่มเติมหน่อยได้ไหมครับ',
      };
    }

    return {
      state: AIResponseState.Answered,
      message: `รับทราบครับ: "${text.slice(0, 120)}" — ระบบตอบกลับอัตโนมัติ (stub)`,
    };
  }

  /** Free — the stub calls nothing. */
  estimateCostUsd(): number {
    return 0;
  }
}
