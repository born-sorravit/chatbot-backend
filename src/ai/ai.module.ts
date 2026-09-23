import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AiAgentEntity,
  AiAgentKnowledgeBaseEntity,
  AiUsageLogEntity,
  CustomerEntity,
  MessageEntity,
} from '../database/entities';
import { AppConfig } from '../config';
import { EMBEDDING_DIMENSIONS } from '../common/constants';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ChatModule } from '../chat/chat.module';
import { ContextService } from './context/context.service';
import { PromptService } from './prompts/prompt.service';
import { ResponseValidator } from './orchestrator/response-validator';
import { AiOrchestrator } from './orchestrator/ai-orchestrator.service';
import { AiUsageService } from './usage/ai-usage.service';
import {
  AnthropicLlmProvider,
  EMBEDDING_PROVIDER,
  LLM_PROVIDER,
  LexicalEmbeddingProvider,
  StubLlmProvider,
  VoyageEmbeddingProvider,
} from './providers';
import { RagService } from './rag/rag.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiAgentEntity,
      AiAgentKnowledgeBaseEntity,
      AiUsageLogEntity,
      MessageEntity,
      CustomerEntity,
    ]),
    EmbeddingsModule,
    ToolsModule,
    forwardRef(() => ConversationsModule),
    forwardRef(() => MessagesModule),
    forwardRef(() => ChatModule),
  ],
  providers: [
    ContextService,
    PromptService,
    ResponseValidator,
    AiUsageService,
    AiOrchestrator,
    AnthropicLlmProvider,
    StubLlmProvider,
    LexicalEmbeddingProvider,
    VoyageEmbeddingProvider,
    RagService,
    {
      // Selected by config, resolved once at boot. Nothing downstream of
      // this token knows which vendor is behind it (docs/ARCHITECTURE.md §6.1).
      provide: LLM_PROVIDER,
      inject: [AppConfig, AnthropicLlmProvider, StubLlmProvider],
      useFactory: (
        config: AppConfig,
        anthropic: AnthropicLlmProvider,
        stub: StubLlmProvider,
      ) => (config.llmProvider === 'anthropic' ? anthropic : stub),
    },
    {
      // Chosen independently of the chat provider (TD-06): the two are
      // different models with different vendors, pricing and lifecycles.
      provide: EMBEDDING_PROVIDER,
      inject: [AppConfig, VoyageEmbeddingProvider, LexicalEmbeddingProvider],
      useFactory: (
        config: AppConfig,
        voyage: VoyageEmbeddingProvider,
        lexical: LexicalEmbeddingProvider,
      ) => {
        const provider = config.embeddingProvider === 'voyage' ? voyage : lexical;

        // Fail at boot, not on the first ingest: a width mismatch silently
        // writes vectors that can never match anything (TD-07).
        if (provider.dimensions !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding provider "${provider.id}" reports ${provider.dimensions} dimensions, ` +
              `but the schema is vector(${EMBEDDING_DIMENSIONS}). Re-index is required to change this.`,
          );
        }

        return provider;
      },
    },
  ],
  exports: [
    AiOrchestrator,
    ContextService,
    PromptService,
    ResponseValidator,
    AiUsageService,
    RagService,
    LLM_PROVIDER,
    EMBEDDING_PROVIDER,
  ],
})
export class AiModule {}
