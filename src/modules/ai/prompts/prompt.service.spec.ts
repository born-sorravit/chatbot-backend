import { PromptService, DEFAULT_SYSTEM_PROMPT } from './prompt.service';
import type { AiAgentEntity } from '@/models/entities';
import type { ConversationContext } from '@/modules/ai/context/context.service';

const agent = {
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  language: 'th',
  tone: 'friendly',
} as AiAgentEntity;

const emptyContext: ConversationContext = {
  recentMessages: [],
  summary: null,
  customer: null,
};

describe('PromptService', () => {
  const service = new PromptService();

  it('keeps the agent-authored prompt first so the cached prefix stays stable', () => {
    const prompt = service.build(agent, emptyContext);
    expect(prompt.startsWith(DEFAULT_SYSTEM_PROMPT.trim())).toBe(true);
  });

  it('carries the anti-hallucination rules through', () => {
    const prompt = service.build(agent, emptyContext);
    expect(prompt).toContain('Never invent prices');
    expect(prompt).toContain('Never invent stock availability');
    expect(prompt).toContain('Never invent order status');
  });

  describe('knowledge section', () => {
    // Three distinct states, worded differently on purpose — the difference
    // is what decides whether the model invents an answer (§23).

    it('says no knowledge base is connected when none is linked', () => {
      const prompt = service.build(agent, emptyContext);
      expect(prompt).toContain('No knowledge base is connected to you');
      expect(prompt).toContain('Do not guess');
    });

    it('says the search returned nothing when it searched and found nothing', () => {
      // Much stronger than silence: it tells the model a lookup happened and
      // failed, which is what pushes it to HANDOFF rather than filling the
      // gap from its own priors.
      const prompt = service.build(agent, emptyContext, {
        chunks: [],
        searched: true,
        maxDistanceUsed: 0.8,
      });

      expect(prompt).toContain('returned NO');
      expect(prompt).toContain('HANDOFF');
      expect(prompt).not.toContain('No knowledge base is connected to you');
    });

    it('quotes retrieved excerpts and forbids answering beyond them', () => {
      const prompt = service.build(agent, emptyContext, {
        searched: true,
        maxDistanceUsed: 0.8,
        chunks: [
          {
            id: 'c1',
            documentId: 'd1',
            documentTitle: 'นโยบายการคืนสินค้า',
            content: 'คืนได้ภายใน 7 วัน',
            distance: 0.4,
            metadata: {},
          },
        ],
      });

      expect(prompt).toContain('นโยบายการคืนสินค้า');
      expect(prompt).toContain('คืนได้ภายใน 7 วัน');
      expect(prompt).toContain('ONLY what appears below');
      expect(prompt).not.toContain('returned NO');
    });
  });

  it('describes the output contract including HANDOFF', () => {
    const prompt = service.build(agent, emptyContext);
    expect(prompt).toContain('ANSWERED');
    expect(prompt).toContain('NEED_MORE_INFORMATION');
    expect(prompt).toContain('HANDOFF');
    expect(prompt).toContain('Never mention these states');
  });

  it('includes customer details only when they are known', () => {
    expect(service.build(agent, emptyContext)).not.toContain('## Customer');

    const withCustomer = service.build(agent, {
      ...emptyContext,
      customer: { name: 'สมชาย', email: null, phone: null },
    });
    expect(withCustomer).toContain('## Customer');
    expect(withCustomer).toContain('สมชาย');
    // Absent fields are omitted rather than rendered as "null".
    expect(withCustomer).not.toContain('null');
  });

  it('includes the conversation summary when one exists', () => {
    const prompt = service.build(agent, { ...emptyContext, summary: 'ลูกค้าถามเรื่องคืนสินค้า' });
    expect(prompt).toContain('ลูกค้าถามเรื่องคืนสินค้า');
  });

  it('reflects the agent language and tone', () => {
    const prompt = service.build(
      { ...agent, language: 'en', tone: 'formal' } as AiAgentEntity,
      emptyContext,
    );
    expect(prompt).toContain('Language: en');
    expect(prompt).toContain('Tone: formal');
  });
});
