import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiAgentsRepository } from '@/models/ai-agents/ai-agents.repository';
import { ConversationsRepository } from '@/models/conversations/conversations.repository';
import { CustomersRepository } from '@/models/customers/customers.repository';
import { DocumentsRepository } from '@/models/knowledge-base/documents.repository';
import { EmbeddingsRepository } from '@/models/knowledge-base/embeddings.repository';
import { KnowledgeBasesRepository } from '@/models/knowledge-base/knowledge-bases.repository';
import { MessagesRepository } from '@/models/messages/messages.repository';
import { UsersRepository } from '@/models/users/users.repository';
import { ENTITIES } from './entities';

const repositories = [
  // Users
  UsersRepository,
  // Customers
  CustomersRepository,
  // Conversations & messages
  ConversationsRepository,
  MessagesRepository,
  // AI agents
  AiAgentsRepository,
  // Knowledge base (RAG)
  KnowledgeBasesRepository,
  DocumentsRepository,
  EmbeddingsRepository,
];

/**
 * Every custom repository, available app-wide. Feature modules inject these directly
 * instead of registering them — one instance each, whoever asks.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature(ENTITIES)],
  providers: [...repositories],
  exports: [...repositories],
})
export class ModelModule {}
