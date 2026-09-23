import { Global, Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ChatModule } from '../chat/chat.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { AdminGateway } from './admin.gateway';
import { CustomerGateway } from './customer.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Global so any service can publish through RealtimeService without importing
 * the gateways — which would create a cycle, since the gateways depend on
 * those same services.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({}),
    forwardRef(() => ChatModule),
    forwardRef(() => ConversationsModule),
    forwardRef(() => MessagesModule),
  ],
  providers: [RealtimeService, AdminGateway, CustomerGateway],
  exports: [RealtimeService],
})
export class WebsocketModule {}
