import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { ConfigService } from '@nestjs/config';
import { aiResponseSchema } from './response.schema';
import type {
  LLMInput,
  LLMProvider,
  LLMResponse,
  LLMStructuredResponse,
  LLMUsage,
} from './llm.provider';

/**
 * Per-million-token pricing, USD (input, output).
 *
 * Only used for the cost estimate in ai_usage_logs, never for billing.
 * Prices move — treat this table as an estimate and refresh it deliberately.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

@Injectable()
export class AnthropicLlmProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly supportsTools = true;
  private readonly logger = new Logger(AnthropicLlmProvider.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.getOrThrow<string>('llm.apiKey');

    // Constructed once. A missing key is not fatal at boot — the provider
    // reports itself not ready and the orchestrator hands off to a human
    // rather than the whole API refusing to start.
    this.client = apiKey ? new Anthropic({ apiKey }) : null;

    if (!this.client) {
      this.logger.warn('LLM_API_KEY is not set — the Anthropic provider is inactive');
    }
  }

  isReady(): boolean {
    return this.client !== null;
  }

  async generateResponse(input: LLMInput): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Anthropic provider is not configured (LLM_API_KEY missing)');
    }

    const startedAt = Date.now();

    /**
     * Message history.
     *
     * When a previous round produced tool calls, the provider-native messages
     * are replayed verbatim and the results appended — Anthropic requires the
     * original `tool_use` blocks back unchanged, and the `tool_use_id` is what
     * pairs each result with its call.
     */
    const messages: Anthropic.MessageParam[] =
      input.providerMessages && input.providerMessages.length > 0
        ? [
            ...(input.providerMessages as Anthropic.MessageParam[]),
            {
              role: 'user',
              content: (input.toolResults ?? []).map((result) => ({
                type: 'tool_result' as const,
                tool_use_id: result.toolUseId,
                content: result.content,
                ...(result.isError ? { is_error: true } : {}),
              })),
            },
          ]
        : input.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }));

    const tools: Anthropic.ToolUnion[] | undefined = input.tools?.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
      // Guarantees the arguments validate against the advertised schema, so
      // the Zod parse on our side is a second line of defence rather than the
      // only one.
      strict: true,
    }));

    /**
     * Structured output and tools are mutually exclusive in one request.
     *
     * Forcing a response format while tools are offered would make the model
     * answer in the structured shape instead of calling a tool. So: offer
     * tools first, and only ask for the structured envelope on the round
     * where no more tools are wanted.
     */
    const useTools = Boolean(tools && tools.length > 0);

    const response = useTools
      ? await this.client.messages.create({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages,
          tools,
          thinking: { type: 'adaptive' },
          output_config: {
            effort: input.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
          },
        })
      : await this.client.messages.parse({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages,
          // Adaptive thinking is the current shape; `budget_tokens` is
          // rejected with a 400 on Opus 5. Depth is controlled by effort.
          thinking: { type: 'adaptive' },
          output_config: {
            effort: input.effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined,
            format: zodOutputFormat(aiResponseSchema),
          },
        });

    const usage: LLMUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    // Text is collected only for diagnostics when parsing fails. Thinking
    // blocks are never read or persisted (§49.12).
    const rawText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n');

    const toolCalls = response.content
      .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    return {
      // `parsed_output` exists only on the structured (non-tool) round; the
      // union of the two call shapes makes its type unknown here, and
      // ResponseValidator re-checks it against the schema regardless.
      parsed:
        'parsed_output' in response
          ? ((response.parsed_output ?? null) as LLMStructuredResponse | null)
          : null,
      rawText: rawText || null,
      stopReason: response.stop_reason,
      usage,
      latencyMs: Date.now() - startedAt,
      model: response.model,
      ...(toolCalls.length > 0
        ? {
            toolCalls,
            // Carried forward so the next round can replay this turn exactly.
            providerMessages: [...messages, { role: 'assistant', content: response.content }],
          }
        : {}),
    };
  }

  estimateCostUsd(model: string, usage: LLMUsage): number {
    const pricing = PRICING[model];

    if (!pricing) {
      return 0;
    }

    return (
      (usage.inputTokens / 1_000_000) * pricing.input +
      (usage.outputTokens / 1_000_000) * pricing.output
    );
  }
}
