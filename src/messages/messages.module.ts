import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationEntity, MessageEntity } from '../database/entities';
import { MessagesRepository } from './messages.repository';
import { MessagesService } from './messages.service';

@Module({
  imports: [TypeOrmModule.forFeature([MessageEntity, ConversationEntity])],
  providers: [MessagesRepository, MessagesService],
  exports: [MessagesRepository, MessagesService],
})
export class MessagesModule {}
