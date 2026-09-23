import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { ServerEvent, room } from './events';

/**
 * The only thing in the codebase that emits.
 *
 * Gateways receive; services publish through here. That keeps the event
 * vocabulary in one place and — once Phase 3 adds the AI worker — makes the
 * worker→socket path identical to the API→socket path, because the Redis
 * adapter routes to whichever instance actually holds the client.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private adminServer: Server | null = null;
  private customerServer: Server | null = null;

  registerAdminServer(server: Server): void {
    this.adminServer = server;
  }

  registerCustomerServer(server: Server): void {
    this.customerServer = server;
  }

  /** A message the customer is allowed to see — no internal fields. */
  emitMessageToCustomer(conversationId: string, payload: unknown): void {
    this.toCustomer(room.conversation(conversationId), ServerEvent.MessageNew, payload);
  }

  emitMessageToAdmins(organizationId: string, conversationId: string, payload: unknown): void {
    this.toAdmin(room.conversation(conversationId), ServerEvent.MessageNew, payload);
    this.toAdmin(room.organization(organizationId), ServerEvent.MessageNew, payload);
  }

  emitConversationNew(organizationId: string, payload: unknown): void {
    this.toAdmin(room.organization(organizationId), ServerEvent.ConversationNew, payload);
  }

  /**
   * Two payloads, not one.
   *
   * The admin and customer rooms get different projections deliberately: the
   * inbox item carries `assignedUser.id`, `handoffReason`, the customer's
   * email and the *admin's* unread count, none of which a customer may see
   * (docs/API.md §2, §7). Fanning a single payload to both namespaces is how
   * that leaks, so the signature makes the two explicit and a caller cannot
   * accidentally send one shape to both.
   *
   * Passing `customerPayload: null` skips the customer namespace entirely,
   * for updates a customer has no business hearing about (assignment, for
   * example).
   */
  emitConversationUpdated(
    organizationId: string,
    conversationId: string,
    adminPayload: unknown,
    customerPayload: unknown | null,
  ): void {
    this.toAdmin(room.organization(organizationId), ServerEvent.ConversationUpdated, adminPayload);
    this.toAdmin(room.conversation(conversationId), ServerEvent.ConversationUpdated, adminPayload);

    if (customerPayload !== null) {
      this.toCustomer(
        room.conversation(conversationId),
        ServerEvent.ConversationUpdated,
        customerPayload,
      );
    }
  }

  emitTyping(
    conversationId: string,
    actor: 'CUSTOMER' | 'ADMIN',
    isTyping: boolean,
    actorName?: string,
  ): void {
    const event = isTyping ? ServerEvent.TypingStart : ServerEvent.TypingStop;
    const payload = { conversationId, actorType: actor, actorName };

    // Typing is echoed to the *other* side only — a client does not need to
    // be told it is typing.
    if (actor === 'CUSTOMER') {
      this.toAdmin(room.conversation(conversationId), event, payload);
    } else {
      this.toCustomer(room.conversation(conversationId), event, payload);
    }
  }

  emitMessageRead(
    conversationId: string,
    readerType: 'CUSTOMER' | 'ADMIN',
    payload: unknown,
  ): void {
    const event = ServerEvent.MessageRead;

    if (readerType === 'ADMIN') {
      this.toCustomer(room.conversation(conversationId), event, payload);
    } else {
      this.toAdmin(room.conversation(conversationId), event, payload);
    }
  }

  /**
   * AI progress signal (master plan §32).
   *
   * Carries a status *enum*, never model-authored text — passing a string
   * the model produced is exactly how internal reasoning reaches a
   * customer's screen. The client maps the enum to localized copy.
   */
  emitAiThinking(conversationId: string, status: string): void {
    this.toCustomer(room.conversation(conversationId), ServerEvent.AiThinking, {
      conversationId,
      status,
    });
  }

  emitAiCompleted(conversationId: string, messageId: string): void {
    this.toCustomer(room.conversation(conversationId), ServerEvent.AiCompleted, {
      conversationId,
      messageId,
    });
  }

  /**
   * Handoff.
   *
   * The reason goes to admins only: a customer does not need to read
   * `AI_CANNOT_ANSWER`. The customer gets the bare signal so the UI can stop
   * showing "AI is thinking".
   */
  emitAiHandoff(organizationId: string, conversationId: string, reason: string): void {
    this.toAdmin(room.organization(organizationId), ServerEvent.AiHandoff, {
      conversationId,
      reason,
    });
    this.toAdmin(room.conversation(conversationId), ServerEvent.AiHandoff, {
      conversationId,
      reason,
    });
    this.toCustomer(room.conversation(conversationId), ServerEvent.AiHandoff, {
      conversationId,
    });
  }

  /**
   * Pushes a notification to one admin's personal room.
   *
   * Per-user rather than per-organization: the row belongs to a person, and
   * broadcasting it would light up everyone's badge for something already
   * assigned elsewhere.
   */
  emitNotification(userId: string, payload: unknown): void {
    this.toAdmin(room.user(userId), ServerEvent.NotificationNew, payload);
  }

  private toAdmin(target: string, event: string, payload: unknown): void {
    if (!this.adminServer) {
      this.logger.warn(`Admin namespace not ready; dropped ${event}`);
      return;
    }
    this.adminServer.to(target).emit(event, payload);
  }

  private toCustomer(target: string, event: string, payload: unknown): void {
    if (!this.customerServer) {
      this.logger.warn(`Customer namespace not ready; dropped ${event}`);
      return;
    }
    this.customerServer.to(target).emit(event, payload);
  }
}
