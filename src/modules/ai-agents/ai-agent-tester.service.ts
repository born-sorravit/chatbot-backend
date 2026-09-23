import { Inject, Injectable } from '@nestjs/common';
import { AiAgentsService } from './ai-agents.service';
import { PromptService } from '@/modules/ai/prompts/prompt.service';
import { ResponseValidator } from '@/modules/ai/orchestrator/response-validator';
import { RagService } from '@/modules/ai/rag/rag.service';
import { LLM_PROVIDER, type LLMProvider } from '@/modules/ai/providers/llm.provider';

/**
 * Runs one turn through the real prompt, retrieval and provider without
 * touching a customer conversation.
 *
 * Deliberately bypasses the orchestrator's persistence and realtime side
 * effects: a prompt test must not create messages, flip modes or notify
 * anyone. It does run retrieval, because a prompt test that skipped RAG would
 * be testing a different prompt than the one customers get.
 */
@Injectable()
export class AiAgentTester {
  constructor(
    private readonly agents: AiAgentsService,
    private readonly prompts: PromptService,
    private readonly validator: ResponseValidator,
    private readonly rag: RagService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
  ) {}

  async run(organizationId: string, agentId: string, message: string) {
    const agent = await this.agents.findById(organizationId, agentId);

    const ragResult = agent.ragEnabled
      ? await this.rag.retrieve(
          organizationId,
          await this.rag.knowledgeBaseIdsForAgent(organizationId, agentId),
          message,
        )
      : undefined;

    const system = this.prompts.build(
      agent,
      { recentMessages: [], summary: null, customer: null },
      ragResult,
    );

    const response = await this.llm.generateResponse({
      model: agent.model,
      system,
      messages: [{ role: 'user', content: message }],
      maxTokens: agent.maxTokens,
      effort: agent.effort,
    });

    const validation = this.validator.validate(response);

    return {
      provider: this.llm.id,
      model: response.model,
      latencyMs: response.latencyMs,
      usage: response.usage,
      estimatedCostUsd: this.llm.estimateCostUsd(agent.model, response.usage),
      // Retrieval diagnostics: "the AI gave a bad answer" is almost always a
      // retrieval problem rather than a prompt problem, and this is what
      // tells them apart.
      retrieval: ragResult
        ? {
            searched: ragResult.searched,
            maxDistance: ragResult.maxDistanceUsed,
            chunks: ragResult.chunks.map((chunk) => ({
              documentTitle: chunk.documentTitle,
              distance: chunk.distance,
              preview: chunk.content.slice(0, 160),
            })),
          }
        : null,
      ...(validation.ok
        ? { state: validation.payload.state, message: validation.payload.message }
        : { state: null, message: null, error: validation.reason }),
    };
  }
}
