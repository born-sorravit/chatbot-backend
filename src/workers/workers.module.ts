import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ChatModule } from '../chat/chat.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { DocumentsModule } from '../documents/documents.module';
import { ChannelsModule } from '../channels/channels.module';
import { AiResponseProcessor } from './ai-response.processor';
import { KnowledgeIngestionProcessor } from './knowledge-ingestion.processor';
import { ChannelDeliveryProcessor } from './channel-delivery.processor';

/**
 * BullMQ processors.
 *
 * Registered only when APP_ROLE is 'worker' or 'all' (see AppModule), so an
 * api-only process produces jobs without also consuming them.
 */
@Module({
  imports: [
    AiModule,
    ChatModule,
    ConversationsModule,
    MessagesModule,
    DocumentsModule,
    ChannelsModule,
  ],
  providers: [AiResponseProcessor, KnowledgeIngestionProcessor, ChannelDeliveryProcessor],
})
export class WorkersModule {}
