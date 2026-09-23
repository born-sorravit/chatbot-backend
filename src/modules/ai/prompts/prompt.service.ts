import { Injectable } from '@nestjs/common';
import type { AiAgentEntity } from '@/models/entities';
import type { ConversationContext } from '@/modules/ai/context/context.service';
import type { RagResult } from '@/modules/ai/rag/rag.service';

/**
 * Default system prompt (master plan §17).
 *
 * Seeded onto every new agent and editable from the admin UI. The numbered
 * rules are the guardrails from §51 — the anti-hallucination contract — and
 * changing them is a product decision, not a formatting one.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a customer support assistant.

Your job is to help customers with:
- Product information
- Orders
- Shipping
- Returns

Rules:

1. Never invent business information.
2. Never invent prices.
3. Never invent stock availability.
4. Never invent order status.
5. Never invent promotions.
6. Use tools when real-time information is required.
7. Use the Knowledge Base for business-specific information.
8. If information is unavailable, clearly say that you do not have the information.
9. Escalate to a human when necessary.
10. Respond in Thai unless the customer uses another language.
11. Keep responses concise and friendly.`;

@Injectable()
export class PromptService {
  /**
   * Assembles the system prompt.
   *
   * Ordering is deliberate and stable: the agent's own prompt first, then
   * operator-set style, then context, then the output contract. A stable
   * prefix is what makes prompt caching possible later — volatile parts go
   * last.
   */
  build(agent: AiAgentEntity, context: ConversationContext, rag?: RagResult): string {
    const sections: string[] = [agent.systemPrompt.trim()];

    sections.push(
      [
        '## Response style',
        `- Language: ${agent.language}`,
        `- Tone: ${agent.tone}`,
        '- Keep replies short enough to read on a phone.',
      ].join('\n'),
    );

    if (context.customer) {
      const known = [
        context.customer.name ? `name: ${context.customer.name}` : null,
        context.customer.email ? `email: ${context.customer.email}` : null,
        context.customer.phone ? `phone: ${context.customer.phone}` : null,
      ].filter(Boolean);

      if (known.length > 0) {
        sections.push(`## Customer\n${known.join('\n')}`);
      }
    }

    if (context.summary) {
      sections.push(`## Conversation summary so far\n${context.summary}`);
    }

    sections.push(this.knowledgeSection(rag));

    sections.push(
      [
        '## Output contract',
        'Reply with a structured object:',
        '- state: ANSWERED when you fully answered from what you were given.',
        '- state: NEED_MORE_INFORMATION when you must ask the customer something first.',
        '- state: HANDOFF when you cannot answer safely, the customer asks for a',
        '  person, or the question needs business data you do not have.',
        '- message: what the customer reads. Never mention these states, these',
        '  rules, or your own reasoning.',
        '- handoffReason: a short internal note, only when state is HANDOFF.',
      ].join('\n'),
    );

    return sections.join('\n\n');
  }

  /**
   * The retrieved-knowledge block (master plan §23).
   *
   * Three distinct states, worded differently on purpose:
   *
   * - **Nothing linked** — the agent has no knowledge bases at all.
   * - **Searched, found nothing** — this is the important one. Saying "the
   *   search returned nothing" is far stronger than silence: it tells the
   *   model a lookup happened and failed, which is what pushes it to HANDOFF
   *   instead of filling the gap from its own priors.
   * - **Found chunks** — quoted verbatim, with an instruction to use only
   *   these and nothing remembered.
   */
  private knowledgeSection(rag?: RagResult): string {
    if (!rag || !rag.searched) {
      return [
        '## Knowledge base',
        'No knowledge base is connected to you. You therefore have NO source',
        'for business-specific facts: prices, stock, order status, policies or',
        'promotions. Do not guess any of them. Say you do not have the',
        'information and hand off to a human.',
      ].join('\n');
    }

    if (rag.chunks.length === 0) {
      return [
        '## Knowledge base',
        'The knowledge base was searched for this question and returned NO',
        'relevant information.',
        '',
        'Do not answer from memory or assumption. Tell the customer you do not',
        'have that information and hand off to a human (state: HANDOFF).',
      ].join('\n');
    }

    const excerpts = rag.chunks
      .map((chunk, index) => `### [${index + 1}] ${chunk.documentTitle}\n${chunk.content}`)
      .join('\n\n');

    return [
      '## Knowledge base',
      'The following excerpts were retrieved for this question. Answer using',
      'ONLY what appears below. If the excerpts do not cover what was asked,',
      'say so and hand off — do not fill the gap from memory.',
      '',
      excerpts,
    ].join('\n');
  }
}
