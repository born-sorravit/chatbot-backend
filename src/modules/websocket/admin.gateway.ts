import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { ConfigService } from '@nestjs/config';
import { ConversationsRepository } from '@/models/conversations/conversations.repository';
import { MessagesService } from '@/modules/messages/messages.service';
import { RealtimeService } from './realtime.service';
import { ClientEvent, WS_NAMESPACE, room } from './events';
import type { AccessTokenPayload } from '@/modules/auth/token.service';

interface AdminSocketData {
  userId: string;
  organizationId: string;
  name: string;
  /** Conversation this socket last signalled typing in, for stop-on-disconnect. */
  typingIn?: string;
  lastTypingAt?: number;
}

/** docs/API.md §7 — typing is throttled to one relay per second per socket. */
const TYPING_THROTTLE_MS = 1_000;

@WebSocketGateway({ namespace: WS_NAMESPACE.admin, cors: true })
export class AdminGateway implements OnGatewayInit, OnGatewayDisconnect {
  private readonly logger = new Logger(AdminGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.registerAdminServer(server);

    /**
     * Authenticate and join rooms in handshake middleware, not in
     * handleConnection.
     *
     * Nest's `handleConnection` is async and runs *after* the client has
     * already been told it is connected, so a client that emits immediately
     * — which every real UI does — can reach a message handler before
     * `socket.data` is populated. Socket.IO middleware is guaranteed to
     * complete before the client's `connect` fires, which removes the race
     * rather than papering over it.
     *
     * Failing the middleware rejects the connection outright, so an
     * unauthenticated socket never joins a room.
     */
    server.use((client: Socket, next: (err?: Error) => void) => {
      void (async () => {
        try {
          const token =
            (client.handshake.auth?.token as string | undefined) ??
            client.handshake.headers.authorization?.replace('Bearer ', '');

          if (!token) {
            throw new Error('missing token');
          }

          const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
            secret: this.config.getOrThrow<string>('security.jwt.secret'),
          });

          const data: AdminSocketData = {
            userId: payload.sub,
            organizationId: payload.org,
            name: payload.email,
          };
          client.data = data;

          // Org room drives inbox-wide events; the per-user room is for the
          // notifications Phase 5 adds.
          client.join(room.organization(data.organizationId));
          client.join(room.user(data.userId));

          next();
        } catch {
          next(new Error('unauthorized'));
        }
      })();
    });
  }

  @SubscribeMessage(ClientEvent.ConversationSubscribe)
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const data = client.data as AdminSocketData;

    if (!body?.conversationId) {
      return { ok: false };
    }

    // Ownership is verified before joining: the room is the authorization
    // boundary, so joining one for another tenant would leak every message
    // broadcast to it.
    const conversation = await this.conversations.findById(
      data.organizationId,
      body.conversationId,
    );

    if (!conversation) {
      this.logger.warn(
        `Admin ${data.userId} tried to subscribe to a conversation outside org ${data.organizationId}`,
      );
      return { ok: false };
    }

    await client.join(room.conversation(conversation.id));
    return { ok: true };
  }

  @SubscribeMessage(ClientEvent.ConversationUnsubscribe)
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.conversationId) {
      await client.leave(room.conversation(body.conversationId));
    }
    return { ok: true };
  }

  @SubscribeMessage(ClientEvent.TypingStart)
  async typingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<void> {
    await this.relayTyping(client, body?.conversationId, true);
  }

  @SubscribeMessage(ClientEvent.TypingStop)
  async typingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<void> {
    await this.relayTyping(client, body?.conversationId, false);
  }

  @SubscribeMessage(ClientEvent.MessageRead)
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const data = client.data as AdminSocketData;

    if (!body?.conversationId) {
      return { ok: false };
    }

    const conversation = await this.conversations.findById(
      data.organizationId,
      body.conversationId,
    );

    if (!conversation) {
      return { ok: false };
    }

    await this.messages.markRead(data.organizationId, conversation.id, 'admin');
    // Admin-only: the customer has no interest in the admin's unread count.
    this.realtime.emitConversationUpdated(
      data.organizationId,
      conversation.id,
      { id: conversation.id, unreadCount: 0, unreadAdminCount: 0 },
      null,
    );

    return { ok: true };
  }

  /**
   * A socket that drops mid-typing would otherwise leave the customer
   * looking at "typing…" forever, because no stop ever arrives.
   */
  handleDisconnect(client: Socket): void {
    const data = client.data as AdminSocketData | undefined;

    if (data?.typingIn) {
      this.realtime.emitTyping(data.typingIn, 'ADMIN', false, data.name);
    }
  }

  private async relayTyping(
    client: Socket,
    conversationId: string | undefined,
    isTyping: boolean,
  ): Promise<void> {
    const data = client.data as AdminSocketData;

    if (!conversationId) {
      return;
    }

    // Throttle starts only — a stop must always get through, or the
    // indicator sticks.
    if (isTyping) {
      const now = Date.now();
      if (data.lastTypingAt && now - data.lastTypingAt < TYPING_THROTTLE_MS) {
        return;
      }
      data.lastTypingAt = now;
    }

    const conversation = await this.conversations.findById(data.organizationId, conversationId);

    if (!conversation) {
      return;
    }

    data.typingIn = isTyping ? conversationId : undefined;
    this.realtime.emitTyping(conversationId, 'ADMIN', isTyping, data.name);
  }
}
