import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiAgentEntity, ConversationEntity } from '../../database/entities';
import { ConversationsRepository } from '../../conversations/conversations.repository';
import { MessagesService } from '../../messages/messages.service';
import { RealtimeService } from '../../websocket/realtime.service';
import { toCustomerMessage } from '../../chat/chat.serializer';
import { toAdminMessage, toInboxItem } from '../../conversations/conversations.serializer';
import {
  AIResponseState,
  AiThinkingStatus,
  ConversationMode,
  HandoffReason,
  MAX_TOOL_ITERATIONS,
  MessageSenderType,
  NotificationType,
} from '../../common/constants';
import { ToolService } from '../../tools/tool.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { ContextService } from '../context/context.service';
import { PromptService } from '../prompts/prompt.service';
import { ResponseValidator } from './response-validator';
import { AiUsageService } from '../usage/ai-usage.service';
import { RagService } from '../rag/rag.service';
import { LLM_PROVIDER, type LLMProvider } from '../providers/llm.provider';

/** Admin-facing wording per reason. The customer never sees these. */
const HANDOFF_MESSAGE: Partial<Record<HandoffReason, string>> = {
  [HandoffReason.NoKnowledgeFound]: 'ไม่พบข้อมูลใน Knowledge Base — อาจต้องเพิ่มเอกสาร',
  [HandoffReason.AiCannotAnswer]: 'AI ไม่สามารถตอบคำถามนี้ได้อย่างปลอดภัย',
  [HandoffReason.ProviderError]: 'ระบบ AI ขัดข้อง',
  [HandoffReason.CustomerRequested]: 'ลูกค้าขอคุยกับเจ้าหน้าที่',
};

export interface OrchestrateInput {
  organizationId: string;
  conversationId: string;
  triggerMessageId: string;
}

export type OrchestrateOutcome =
  | { status: 'replied'; messageId: string; state: AIResponseState }
  | { status: 'skipped'; reason: string }
  | { status: 'handoff'; reason: HandoffReason };

/**
 * Turns a customer message into an AI reply (docs/ARCHITECTURE.md §6.4).
 *
 * Runs in the worker, never in an HTTP request — the queue is the boundary
 * (§4.1).
 */
@Injectable()
export class AiOrchestrator {
  private readonly logger = new Logger(AiOrchestrator.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
    private readonly context: ContextService,
    private readonly prompts: PromptService,
    private readonly validator: ResponseValidator,
    private readonly usage: AiUsageService,
    private readonly rag: RagService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly tools: ToolService,
    @Inject(LLM_PROVIDER) private readonly llm: LLMProvider,
    @InjectRepository(AiAgentEntity)
    private readonly agents: Repository<AiAgentEntity>,
  ) {}

  async handle(input: OrchestrateInput): Promise<OrchestrateOutcome> {
    const { organizationId, conversationId, triggerMessageId } = input;

    const conversation = await this.conversations.findById(organizationId, conversationId);

    if (!conversation) {
      return { status: 'skipped', reason: 'conversation not found' };
    }

    /**
     * The takeover race guard (R-03).
     *
     * An admin may have taken this conversation over between the job being
     * enqueued and this worker picking it up. Checking only at enqueue time
     * leaves a window where the AI still posts after a human took the thread,
     * which is exactly what §30 forbids. Cancelling jobs is racy; re-reading
     * the mode at the point of write is not.
     */
    if (conversation.mode !== ConversationMode.Ai) {
      this.logger.log({
        event: 'ai.skipped_human_mode',
        conversationId,
        organizationId,
      });
      return { status: 'skipped', reason: 'conversation is in HUMAN mode' };
    }

    const agent = await this.resolveAgent(organizationId, conversation);

    if (!agent) {
      return { status: 'skipped', reason: 'no active AI agent configured' };
    }

    if (!agent.autoReply) {
      return { status: 'skipped', reason: 'agent auto-reply is disabled' };
    }

    this.realtime.emitAiThinking(conversationId, AiThinkingStatus.Thinking);

    const context = await this.context.build(conversation, agent.maxContextMessages);

    /**
     * Retrieval (master plan §22).
     *
     * The *latest customer message* is the query, not the whole transcript:
     * embedding the full history would blur the question against everything
     * discussed earlier and retrieve whatever the conversation has drifted
     * over.
     *
     * `ragEnabled` is honoured, and a nil result is passed through rather
     * than skipped — PromptService words "searched and found nothing" very
     * differently from "no knowledge base connected", and that difference is
     * what pushes the model to hand off instead of inventing (§23).
     */
    let rag;
    if (agent.ragEnabled) {
      this.realtime.emitAiThinking(conversationId, AiThinkingStatus.SearchingKnowledge);

      const knowledgeBaseIds = await this.rag.knowledgeBaseIdsForAgent(
        organizationId,
        agent.id,
      );

      const question = [...context.recentMessages]
        .reverse()
        .find((message) => message.role === 'user')?.content;

      if (question) {
        rag = await this.rag.retrieve(organizationId, knowledgeBaseIds, question);
      }
    }

    const system = this.prompts.build(agent, context, rag);

    const toolDefinitions = this.llm.supportsTools
      ? await this.tools.definitionsForAgent(organizationId, agent.id)
      : [];

    let response;
    try {
      response = await this.runWithTools({
        agent,
        system,
        messages: context.recentMessages,
        toolDefinitions,
        context: {
          organizationId,
          conversationId,
          customerId: conversation.customerId,
          requestId: triggerMessageId,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ event: 'ai.provider_error', conversationId, message });

      await this.usage.record({
        organizationId,
        conversationId,
        purpose: 'response',
        provider: this.llm.id,
        model: agent.model,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
        latencyMs: 0,
        success: false,
        errorCode: 'PROVIDER_ERROR',
      });

      // Rethrow so BullMQ retries. The handoff only happens once the retries
      // are exhausted — see the processor's failure handler.
      throw error;
    }

    await this.usage.record({
      organizationId,
      conversationId,
      purpose: 'response',
      provider: this.llm.id,
      model: response.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      estimatedCostUsd: this.llm.estimateCostUsd(agent.model, response.usage),
      latencyMs: response.latencyMs,
      success: true,
    });

    const validation = this.validator.validate(response);

    if (!validation.ok) {
      throw new Error(`AI response validation failed: ${validation.reason}`);
    }

    const { state, message, handoffReason } = validation.payload;

    /**
     * Exhaustive branch — no fall-through (docs/ARCHITECTURE.md §6.5).
     *
     * TOOL_REQUIRED should not arrive in Phase 3: there are no tools yet, and
     * from Phase 6 a tool call surfaces as a stop reason before validation.
     * It is handled anyway because an unhandled enum member is how a customer
     * ends up receiving silence.
     */
    switch (state) {
      case AIResponseState.Answered:
      case AIResponseState.NeedMoreInformation:
        return this.reply(conversation, triggerMessageId, message, state);

      case AIResponseState.ToolRequired:
        // No tool loop exists yet, so the safe move is a person.
        return this.handoff(
          conversation,
          triggerMessageId,
          message,
          HandoffReason.AiCannotAnswer,
          handoffReason ?? 'Model requested a tool, but no tools are available yet',
        );

      case AIResponseState.Handoff:
        return this.handoff(
          conversation,
          triggerMessageId,
          message,
          // Distinguish "searched the knowledge base and found nothing" from
          // "could not answer for some other reason": the first tells an
          // admin to add a document, the second does not.
          rag?.searched && rag.chunks.length === 0
            ? HandoffReason.NoKnowledgeFound
            : HandoffReason.AiCannotAnswer,
          handoffReason ?? 'Model requested handoff',
        );
    }
  }

  /**
   * The tool loop (docs/ARCHITECTURE.md §6.4 step 7).
   *
   *   model → tool_use? → permission + validation + execute → results → model
   *
   * Capped at MAX_TOOL_ITERATIONS. Without a cap a model that keeps asking
   * for tools burns tokens until max_tokens stops it; on exceeding the cap
   * the caller degrades to HANDOFF rather than answering without the data it
   * was trying to fetch.
   *
   * Tool *failures* are fed back to the model as results rather than thrown:
   * the model can then tell the customer it could not retrieve the
   * information, which is the honest answer and far better than a 500.
   */
  private async runWithTools(params: {
    agent: AiAgentEntity;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    toolDefinitions: { name: string; description: string; inputSchema: Record<string, unknown> }[];
    context: {
      organizationId: string;
      conversationId: string;
      customerId: string;
      requestId: string;
    };
  }) {
    const { agent, system, messages, toolDefinitions, context } = params;

    let providerMessages: unknown[] | undefined;
    let toolResults: { toolUseId: string; content: string; isError?: boolean }[] | undefined;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const response = await this.llm.generateResponse({
        model: agent.model,
        system,
        messages,
        maxTokens: agent.maxTokens,
        effort: agent.effort,
        // Tools are offered only while iterations remain. On the final round
        // they are withheld so the model must produce the structured answer
        // instead of asking for yet another call it cannot get.
        tools: iteration < MAX_TOOL_ITERATIONS - 1 ? toolDefinitions : undefined,
        providerMessages,
        toolResults,
      });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response;
      }

      this.realtime.emitAiThinking(context.conversationId, AiThinkingStatus.CheckingOrder);

      // Executed in parallel: a model may request several independent lookups
      // in one turn, and serialising them would multiply the latency the
      // customer waits through.
      const results = await Promise.all(
        response.toolCalls.map(async (call) => {
          const result = await this.tools.execute(
            context.organizationId,
            agent.id,
            call.name,
            call.input,
            context,
          );

          return {
            toolUseId: call.id,
            content: result.ok
              ? JSON.stringify(result.output)
              : result.error,
            isError: !result.ok,
          };
        }),
      );

      providerMessages = response.providerMessages;
      toolResults = results;
    }

    // Iterations exhausted with the model still asking for tools.
    throw new Error('Tool loop exceeded the maximum number of iterations');
  }

  /** The agent for this conversation: the one pinned to it, else the default. */
  private async resolveAgent(
    organizationId: string,
    conversation: ConversationEntity,
  ): Promise<AiAgentEntity | null> {
    if (conversation.aiAgentId) {
      const pinned = await this.agents.findOne({
        where: { id: conversation.aiAgentId, organizationId, isActive: true },
      });
      if (pinned) {
        return pinned;
      }
    }

    return this.agents.findOne({
      where: { organizationId, isDefault: true, isActive: true },
    });
  }

  private async reply(
    conversation: ConversationEntity,
    triggerMessageId: string,
    content: string,
    state: AIResponseState,
  ): Promise<OrchestrateOutcome> {
    const { message, conversation: updated } = await this.messages.create({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      senderType: MessageSenderType.Ai,
      content,
      // Idempotency: the partial unique index on this column makes a second
      // AI reply to the same customer message impossible (TD-10).
      triggerMessageId,
    });

    this.emitMessage(updated, message);
    this.realtime.emitAiCompleted(conversation.id, message.id);

    return { status: 'replied', messageId: message.id, state };
  }

  /**
   * Hands the conversation to a human.
   *
   * The customer-facing line is saved as a normal AI message; the reason is
   * recorded on the conversation for admins only and never emitted to the
   * customer namespace (docs/API.md §7).
   */
  private async handoff(
    conversation: ConversationEntity,
    triggerMessageId: string,
    content: string,
    reason: HandoffReason,
    internalNote: string,
  ): Promise<OrchestrateOutcome> {
    const { message, conversation: updated } = await this.messages.create({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      senderType: MessageSenderType.Ai,
      content,
      triggerMessageId,
      metadata: { handoffNote: internalNote },
      // Mode flip rides in the same transaction as the message, so there is
      // no window where the handoff line exists but the mode is still AI.
      conversationPatch: {
        mode: ConversationMode.Human,
        handoffReason: reason,
        handoffAt: new Date(),
      },
    });

    this.emitMessage(updated, message);

    this.realtime.emitAiHandoff(
      conversation.organizationId,
      conversation.id,
      reason,
    );

    void this.notifications.notify({
      organizationId: conversation.organizationId,
      type: NotificationType.AiHandoff,
      title: 'AI ส่งต่อให้แอดมิน',
      message: HANDOFF_MESSAGE[reason] ?? 'AI ไม่สามารถตอบคำถามนี้ได้',
      conversationId: conversation.id,
      metadata: { reason, note: internalNote },
    });

    this.logger.log({
      event: 'ai.handoff',
      conversationId: conversation.id,
      organizationId: conversation.organizationId,
      reason,
    });

    return { status: 'handoff', reason };
  }

  private emitMessage(
    conversation: ConversationEntity,
    message: Parameters<typeof toAdminMessage>[0],
  ): void {
    const organizationId = conversation.organizationId;

    this.realtime.emitMessageToCustomer(
      conversation.id,
      toCustomerMessage(message),
    );
    this.realtime.emitMessageToAdmins(organizationId, conversation.id, toAdminMessage(message));
    this.realtime.emitConversationUpdated(
      organizationId,
      conversation.id,
      toInboxItem(conversation, message),
      {
        id: conversation.id,
        status: conversation.status,
        mode: conversation.mode,
        unreadCount: conversation.unreadCustomerCount,
        lastMessageAt: message.createdAt.toISOString(),
        createdAt: conversation.createdAt.toISOString(),
      },
    );
  }
}
