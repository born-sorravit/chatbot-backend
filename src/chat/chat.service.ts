import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConversationEntity,
  CustomerEntity,
  OrganizationEntity,
  UserEntity,
} from '../database/entities';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { MessagesService } from '../messages/messages.service';
import { CustomerSessionService, type SessionContext } from './customer-session.service';
import { RealtimeService } from '../websocket/realtime.service';
import {
  CHANNEL_WEB,
  ConversationMode,
  ConversationStatus,
  HandoffReason,
  MessageSenderType,
  NotificationType,
} from '../common/constants';
import { NotificationsService } from '../notifications/notifications.service';
import { toCustomerConversation, toCustomerMessage } from './chat.serializer';
import { AiResponseQueue } from '../queue/ai-response.queue';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
    private readonly sessions: CustomerSessionService,
    private readonly realtime: RealtimeService,
    private readonly aiQueue: AiResponseQueue,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * First widget load, or a returning visitor.
   *
   * Resume rule (TD-09): an existing OPEN/PENDING conversation is resumed; a
   * CLOSED one is *not* reopened — a new conversation is created for the same
   * customer. Closed means resolved, and appending a new issue to a finished
   * thread breaks both the admin's queue semantics and Phase 7's resolution
   * metrics.
   */
  async startSession(
    organizationSlug: string,
    profile: { name?: string; email?: string },
    existingToken: string | undefined,
    context: SessionContext,
  ) {
    const organization = await this.organizations.findOne({
      where: { slug: organizationSlug },
    });

    if (!organization) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Organization not found',
      });
    }

    let customerId: string | null = null;
    let sessionToken: string | null = null;

    if (existingToken) {
      const resolved = await this.sessions
        .resolve(existingToken)
        .catch(() => null);

      // Only reuse a session belonging to this organization — a token from
      // another tenant must not resurrect a customer here.
      if (resolved && resolved.organizationId === organization.id) {
        customerId = resolved.customerId;
        sessionToken = existingToken;
      }
    }

    if (!customerId) {
      const customer = await this.customers.save(
        this.customers.create({
          organizationId: organization.id,
          name: profile.name ?? null,
          email: profile.email ?? null,
          metadata: {},
          tags: [],
        }),
      );
      customerId = customer.id;
    }

    if (!sessionToken) {
      const issued = await this.sessions.issue(organization.id, customerId, context);
      sessionToken = issued.token;
    }

    let conversation = await this.conversations.findActiveForCustomer(
      organization.id,
      customerId,
    );
    let isNew = false;

    if (!conversation) {
      conversation = await this.conversationRepo.save(
        this.conversationRepo.create({
          organizationId: organization.id,
          customerId,
          status: ConversationStatus.Open,
          // Phase 2 has no AI worker yet; the mode column still drives the
          // inbox filters and is the switch Phase 3 reads.
          mode: ConversationMode.Ai,
          channel: CHANNEL_WEB,
        }),
      );
      isNew = true;
    }

    const customer = await this.customers.findOneOrFail({ where: { id: customerId } });

    if (isNew) {
      void this.notifications.notify({
        organizationId: organization.id,
        type: NotificationType.NewConversation,
        title: 'การสนทนาใหม่',
        message: `${customer.name ?? 'ลูกค้า'} เริ่มการสนทนาใหม่`,
        conversationId: conversation.id,
      });

      this.realtime.emitConversationNew(organization.id, {
        id: conversation.id,
        customer: { id: customer.id, name: customer.name, avatarUrl: customer.avatarUrl },
        status: conversation.status,
        mode: conversation.mode,
        channel: conversation.channel,
        assignedUser: null,
        lastMessage: null,
        unreadCount: 0,
        lastMessageAt: null,
        createdAt: conversation.createdAt.toISOString(),
      });
    }

    return {
      sessionToken,
      customer: { id: customer.id, name: customer.name, email: customer.email },
      conversation: toCustomerConversation(conversation),
    };
  }

  /**
   * The conversation this session is talking in.
   *
   * Deliberately the *latest* rather than the latest open one: a customer
   * whose thread an admin just closed must still see it, and their next
   * message reopens it.
   */
  private async requireConversation(
    organizationId: string,
    customerId: string,
  ): Promise<ConversationEntity> {
    const conversation = await this.conversations.findLatestForCustomer(
      organizationId,
      customerId,
    );

    if (!conversation) {
      throw new NotFoundException({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'No active conversation for this session',
      });
    }

    return conversation;
  }

  async getConversation(organizationId: string, customerId: string) {
    return toCustomerConversation(await this.requireConversation(organizationId, customerId));
  }

  async listMessages(
    organizationId: string,
    customerId: string,
    before: string | undefined,
    limit: number,
  ) {
    const conversation = await this.requireConversation(organizationId, customerId);
    const page = await this.messages.list(organizationId, conversation.id, before, limit);

    const adminNames = await this.adminNameMap(page.messages.map((m) => m.senderId));

    return {
      data: page.messages.map((message) =>
        toCustomerMessage(
          message,
          message.senderType === MessageSenderType.Admin && message.senderId
            ? (adminNames.get(message.senderId) ?? null)
            : null,
        ),
      ),
      meta: { hasMore: page.hasMore, nextCursor: page.nextCursor },
    };
  }

  /**
   * Customer sends a message.
   *
   * This is the §4.1 boundary: the message is stored, an AI job is enqueued
   * when the conversation is in AI mode, and the handler returns. It never
   * awaits an LLM — the reply arrives over WebSocket.
   */
  async sendMessage(
    organizationId: string,
    customerId: string,
    content: string,
    clientMessageId: string | undefined,
  ) {
    const active = await this.requireConversation(organizationId, customerId);

    const { message, conversation } = await this.messages.create({
      organizationId,
      conversationId: active.id,
      senderType: MessageSenderType.Customer,
      senderId: customerId,
      content,
      metadata: clientMessageId ? { clientMessageId } : {},
    });

    const view = toCustomerMessage(message);
    const customer = await this.customers.findOne({ where: { id: customerId } });

    this.realtime.emitMessageToAdmins(organizationId, conversation.id, {
      ...view,
      conversationId: conversation.id,
      senderId: customerId,
    });
    this.realtime.emitConversationUpdated(
      organizationId,
      conversation.id,
      {
        id: conversation.id,
        customer: customer
          ? { id: customer.id, name: customer.name, avatarUrl: customer.avatarUrl }
          : null,
        status: conversation.status,
        mode: conversation.mode,
        lastMessage: {
          content: message.content,
          senderType: message.senderType,
          type: message.type,
          createdAt: view.createdAt,
        },
        // The admin's badge. Deliberately not sent to the customer.
        unreadCount: conversation.unreadAdminCount,
        lastMessageAt: view.createdAt,
      },
      // The customer echoes its own message; it does not need a conversation
      // update for something it just did.
      null,
    );

    if (conversation.assignedUserId) {
      // Only the assignee — notifying the whole team about a thread someone
      // else already owns is the noise that teaches people to ignore badges.
      void this.notifications.notify({
        organizationId,
        userId: conversation.assignedUserId,
        type: NotificationType.NewMessage,
        title: 'ข้อความใหม่',
        message: `${customer?.name ?? 'ลูกค้า'}: ${content.slice(0, 80)}`,
        conversationId: conversation.id,
      });
    }

    if (conversation.mode === ConversationMode.Ai) {
      await this.aiQueue.enqueue({
        organizationId,
        conversationId: conversation.id,
        triggerMessageId: message.id,
      });
    }

    return view;
  }

  /**
   * Customer explicitly asks for a person (master plan §53).
   *
   * An explicit endpoint alongside natural-language detection: a button is
   * unambiguous, and a phrasing the model fails to recognise is a customer
   * left waiting. This path never consults the AI at all.
   */
  async requestHuman(organizationId: string, customerId: string) {
    const active = await this.requireConversation(organizationId, customerId);

    if (active.mode === ConversationMode.Human) {
      // Already with a human — saying so beats inserting a duplicate system
      // message every time the button is pressed.
      return toCustomerConversation(active);
    }

    const { conversation } = await this.messages.create({
      organizationId,
      conversationId: active.id,
      senderType: MessageSenderType.System,
      content: 'ลูกค้าขอคุยกับเจ้าหน้าที่',
      metadata: { kind: 'customer-requested-human' },
      // Mode flip rides in the message transaction, so there is no window
      // where the request is recorded but the AI could still reply.
      conversationPatch: {
        mode: ConversationMode.Human,
        status: ConversationStatus.Open,
        handoffReason: HandoffReason.CustomerRequested,
        handoffAt: new Date(),
      },
    });

    const customer = await this.customers.findOne({ where: { id: customerId } });

    void this.notifications.notify({
      organizationId,
      type: NotificationType.CustomerRequestedHuman,
      title: 'ลูกค้าขอคุยกับเจ้าหน้าที่',
      message: `${customer?.name ?? 'ลูกค้า'} ขอคุยกับเจ้าหน้าที่`,
      conversationId: conversation.id,
    });

    this.realtime.emitConversationUpdated(
      organizationId,
      conversation.id,
      {
        id: conversation.id,
        status: conversation.status,
        mode: conversation.mode,
        handoffReason: conversation.handoffReason,
        unreadCount: conversation.unreadAdminCount,
      },
      toCustomerConversation(conversation),
    );

    this.realtime.emitAiHandoff(organizationId, conversation.id, HandoffReason.CustomerRequested);

    return toCustomerConversation(conversation);
  }

  async markRead(organizationId: string, customerId: string): Promise<void> {
    const conversation = await this.requireConversation(organizationId, customerId);
    await this.messages.markRead(organizationId, conversation.id, 'customer');
  }

  async setTyping(
    organizationId: string,
    customerId: string,
    isTyping: boolean,
  ): Promise<void> {
    const conversation = await this.requireConversation(organizationId, customerId);
    this.realtime.emitTyping(conversation.id, 'CUSTOMER', isTyping);
  }

  /** Resolves admin display names in one query rather than per message. */
  private async adminNameMap(senderIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(senderIds.filter((id): id is string => Boolean(id)))];

    if (ids.length === 0) {
      return new Map();
    }

    const users = await this.users.find({ where: ids.map((id) => ({ id })) });
    return new Map(users.map((user) => [user.id, user.name]));
  }
}
