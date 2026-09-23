import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ConversationEntity,
  CustomerEntity,
  CustomerSessionEntity,
  OrganizationEntity,
  UserEntity,
} from '../database/entities';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CustomerSessionService } from './customer-session.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationEntity,
      CustomerEntity,
      CustomerSessionEntity,
      ConversationEntity,
      UserEntity,
    ]),
    forwardRef(() => ConversationsModule),
    forwardRef(() => MessagesModule),
  ],
  controllers: [ChatController],
  providers: [ChatService, CustomerSessionService],
  exports: [CustomerSessionService, ChatService],
})
export class ChatModule {}
