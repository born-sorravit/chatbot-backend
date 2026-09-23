import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { CustomerSessionService } from '@/modules/chat/customer-session.service';
import { ConversationsRepository } from '@/models/conversations/conversations.repository';
import { MessagesService } from '@/modules/messages/messages.service';
import { RealtimeService } from './realtime.service';
import { ClientEvent, WS_NAMESPACE, room } from './events';
import { readSessionCookie } from '@/shared/guards/customer-session.guard';

interface CustomerSocketData {
  customerId: string;
  organizationId: string;
  conversationId: string;
  typing?: boolean;
  lastTypingAt?: number;
}

/** docs/API.md §7 — one relay per second per socket. */
const TYPING_THROTTLE_MS = 1_000;

/**
 * The customer half of the realtime surface.
 *
 * A customer socket joins exactly one room — its own conversation — and the
 * room is resolved server-side from the session token. The client never names
 * a conversation, so it cannot ask to listen to someone else's.
 */
@WebSocketGateway({ namespace: WS_NAMESPACE.customer, cors: true })
export class CustomerGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly sessions: CustomerSessionService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.registerCustomerServer(server);

    // Handshake middleware for the same reason as AdminGateway: it completes
    // before the client's `connect` fires, so a customer emitting straight
    // away cannot beat their own session resolution.
    server.use((client: Socket, next: (err?: Error) => void) => {
      void (async () => {
        try {
          // Cookie first: it is httpOnly, so the widget's own JS cannot read
          // it to hand over in `auth`. The explicit token stays as a fallback
          // for embeds where a third-party cookie is blocked.
          const token =
            readSessionCookie(client.handshake.headers.cookie) ??
            (client.handshake.auth?.token as string | undefined);

          const customer = await this.sessions.resolve(token);

          const conversation = await this.conversations.findLatestForCustomer(
            customer.organizationId,
            customer.customerId,
          );

          if (!conversation) {
            throw new Error('no active conversation');
          }

          const data: CustomerSocketData = {
            customerId: customer.customerId,
            organizationId: customer.organizationId,
            conversationId: conversation.id,
          };
          client.data = data;

          // Exactly one room, resolved server-side from the session token.
          // The client never names a conversation, so it cannot ask to
          // listen to someone else's.
          client.join(room.conversation(conversation.id));

          next();
        } catch {
          next(new Error('unauthorized'));
        }
      })();
    });
  }

  /** Closing the widget mid-typing must not leave the admin seeing "typing…". */
  handleDisconnect(client: Socket): void {
    const data = client.data as CustomerSocketData | undefined;

    if (data?.typing && data.conversationId) {
      this.realtime.emitTyping(data.conversationId, 'CUSTOMER', false);
    }
  }

  @SubscribeMessage(ClientEvent.TypingStart)
  typingStart(@ConnectedSocket() client: Socket): void {
    const data = client.data as CustomerSocketData;

    if (!data?.conversationId) {
      return;
    }

    // Starts are throttled; stops always pass, or the indicator sticks.
    const now = Date.now();
    if (data.lastTypingAt && now - data.lastTypingAt < TYPING_THROTTLE_MS) {
      return;
    }
    data.lastTypingAt = now;
    data.typing = true;

    this.realtime.emitTyping(data.conversationId, 'CUSTOMER', true);
  }

  @SubscribeMessage(ClientEvent.TypingStop)
  typingStop(@ConnectedSocket() client: Socket): void {
    const data = client.data as CustomerSocketData;

    if (data?.conversationId) {
      data.typing = false;
      this.realtime.emitTyping(data.conversationId, 'CUSTOMER', false);
    }
  }

  @SubscribeMessage(ClientEvent.MessageRead)
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() _body: unknown,
  ): Promise<{ ok: boolean }> {
    const data = client.data as CustomerSocketData;

    if (!data?.conversationId) {
      return { ok: false };
    }

    // The conversation comes from the socket's own session, never from the
    // payload — there is nothing here for a client to point elsewhere.
    await this.messages.markRead(data.organizationId, data.conversationId, 'customer');
    this.realtime.emitMessageRead(data.conversationId, 'CUSTOMER', {
      conversationId: data.conversationId,
      readAt: new Date().toISOString(),
    });

    return { ok: true };
  }
}
