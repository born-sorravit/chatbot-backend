import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiAgentEntity, ConversationEntity, MessageEntity, UserEntity } from '../database/entities';
import { MessagesModule } from '../messages/messages.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsRepository } from './conversations.repository';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationEntity, MessageEntity, UserEntity, AiAgentEntity]),
    forwardRef(() => MessagesModule),
  ],
  controllers: [ConversationsController],
  providers: [ConversationsRepository, ConversationsService],
  exports: [ConversationsRepository, ConversationsService],
})
export class ConversationsModule {}
