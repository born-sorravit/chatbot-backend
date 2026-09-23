import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ChannelIntegrationEntity,
  ConversationEntity,
  CustomerChannelIdentityEntity,
  CustomerEntity,
  MessageEntity,
} from '@/models/entities';
import { ConversationsModule } from '@/modules/conversations/conversations.module';
import { MessagesModule } from '@/modules/messages/messages.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { WebsocketModule } from '@/modules/websocket/websocket.module';
import { ChannelRegistry } from './channel-registry.service';
import { ChannelInboundService } from './channel-inbound.service';
import { ChannelDeliveryService } from './channel-delivery.service';
import { ChannelsAdminService } from './channels-admin.service';
import { ChannelsAdminController } from './channels-admin.controller';
import { ChannelWebhookController } from './channel-webhook.controller';
import { LineAdapter } from './adapters/line.adapter';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChannelIntegrationEntity,
      CustomerChannelIdentityEntity,
      CustomerEntity,
      ConversationEntity,
      MessageEntity,
    ]),
    ConversationsModule,
    MessagesModule,
    NotificationsModule,
    WebsocketModule,
  ],
  controllers: [ChannelsAdminController, ChannelWebhookController],
  providers: [
    LineAdapter,
    FacebookAdapter,
    WhatsappAdapter,
    ChannelRegistry,
    ChannelInboundService,
    ChannelDeliveryService,
    ChannelsAdminService,
  ],
  exports: [ChannelRegistry, ChannelDeliveryService, ChannelInboundService],
})
export class ChannelsModule {}
