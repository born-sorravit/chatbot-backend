import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiAgentEntity, MessageEntity, UserEntity } from '@/models/entities';
import { ConversationsRepository } from '@/models/conversations/conversations.repository';
import { MessagesService } from '@/modules/messages/messages.service';
import { RealtimeService } from '@/modules/websocket/realtime.service';
import { toAdminMessage, toConversationDetail, toInboxItem } from './conversations.serializer';
import { toCustomerConversation, toCustomerMessage } from '@/modules/chat/chat.serializer';
import {
  ConversationMode,
  ConversationStatus,
  HandoffReason,
  MessageSenderType,
} from '@/shared/constants';
import type { ListConversationsDto } from './dto';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    @InjectRepository(AiAgentEntity)
    private readonly agents: Repository<AiAgentEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
  ) {}

  async list(organizationId: string, query: ListConversationsDto) {
    const skip = (query.page - 1) * query.limit;

    const [conversations, total] = await this.conversations.listForInbox(
      organizationId,
      {
        status: query.status,
        mode: query.mode,
        assignedUserId: query.assignedUserId as string | 'unassigned' | undefined,
        customerId: query.customerId,
        search: query.search,
      },
      skip,
      query.limit,
    );

    const lastMessages = await this.lastMessageMap(conversations.map((c) => c.id));

    return {
      data: conversations.map((conversation) =>
        toInboxItem(conversation, lastMessages.get(conversation.id) ?? null),
      ),
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        hasMore: skip + conversations.length < total,
      },
    };
  }

  async detail(organizationId: string, conversationId: string) {
    const conversation = await this.conversations.findByIdOrFail(organizationId, conversationId, {
      customer: true,
      assignedUser: true,
    });
    return toConversationDetail(conversation);
  }

  async listMessages(
    organizationId: string,
    conversationId: string,
    before: string | undefined,
    limit: number,
  ) {
    // Ownership check first — a message list for another tenant's
    // conversation must 404 before any message is read.
    await this.conversations.findByIdOrFail(organizationId, conversationId);
    const page = await this.messages.list(organizationId, conversationId, before, limit);

    return {
      data: page.messages.map(toAdminMessage),
      meta: { hasMore: page.hasMore, nextCursor: page.nextCursor },
    };
  }

  /**
   * Admin reply.
   *
   * An admin speaking implies takeover: if the conversation is still in AI
   * mode it flips to HUMAN in the same operation. Otherwise the AI would
   * answer alongside the human, which is not what §30 means by a human owning
   * the thread.
   */
  async reply(
    organizationId: string,
    conversationId: string,
    user: { id: string; name: string },
    content: string,
    clientMessageId: string | undefined,
  ) {
    const existing = await this.conversations.findByIdOrFail(organizationId, conversationId, {
      customer: true,
      assignedUser: true,
    });

    const wasAi = existing.mode === ConversationMode.Ai;

    // Takeover and assignment ride along in the message transaction rather
    // than following it. Split apart, a failure between the two leaves an
    // admin message sitting in an AI-mode conversation — the exact state §30
    // forbids, and the window Phase 3's AI worker could read `mode = AI` in.
    const { message } = await this.messages.create({
      organizationId,
      conversationId,
      senderType: MessageSenderType.Admin,
      senderId: user.id,
      content,
      metadata: clientMessageId ? { clientMessageId } : {},
      conversationPatch: {
        ...(wasAi
          ? {
              mode: ConversationMode.Human,
              handoffReason: HandoffReason.ManualTakeover,
              handoffAt: new Date(),
            }
          : {}),
        ...(existing.assignedUserId ? {} : { assignedUserId: user.id }),
      },
    });

    const fresh = await this.conversations.findByIdOrFail(organizationId, conversationId, {
      customer: true,
      assignedUser: true,
    });

    // The customer sees the admin's display name only — never their id or email.
    this.realtime.emitMessageToCustomer(
      conversationId,
      toCustomerMessage(message, user.name),
    );
    this.realtime.emitMessageToAdmins(organizationId, conversationId, toAdminMessage(message));
    this.realtime.emitConversationUpdated(
      organizationId,
      conversationId,
      toInboxItem(fresh, message),
      toCustomerConversation(fresh),
    );

    return toAdminMessage(message);
  }

  /**
   * Explicit Take Over (master plan §30).
   *
   * Flips to HUMAN, assigns the conversation, and records a SYSTEM message so
   * the transcript shows when a person stepped in.
   *
   * In-flight AI jobs are deliberately *not* cancelled — cancellation is racy.
   * The worker re-reads `mode` immediately before it writes, so a job already
   * running becomes a no-op (R-03). That is why "AI stops immediately" is true
   * without touching the queue.
   */
  async takeOver(
    organizationId: string,
    conversationId: string,
    user: { id: string; name: string },
  ) {
    const conversation = await this.conversations.findByIdOrFail(organizationId, conversationId);

    if (conversation.mode === ConversationMode.Human && conversation.assignedUserId === user.id) {
      // Already owned by this admin — nothing to do, and re-announcing it in
      // the transcript would be noise.
      return this.emitUpdated(organizationId, conversationId);
    }

    await this.messages.create({
      organizationId,
      conversationId,
      senderType: MessageSenderType.System,
      content: `${user.name} รับช่วงการสนทนาต่อจาก AI`,
      metadata: { kind: 'takeover', userId: user.id },
      conversationPatch: {
        mode: ConversationMode.Human,
        status: ConversationStatus.Open,
        assignedUserId: user.id,
        handoffReason: HandoffReason.ManualTakeover,
        handoffAt: new Date(),
      },
    });

    return this.emitUpdated(organizationId, conversationId);
  }

  /**
   * Return to AI (master plan §31).
   *
   * The conversation context is left untouched, so the AI resumes with the
   * full transcript including whatever the admin said — clearing it would
   * make the AI's next reply read as if the human exchange never happened.
   */
  async returnToAi(
    organizationId: string,
    conversationId: string,
    user: { id: string; name: string },
  ) {
    const conversation = await this.conversations.findByIdOrFail(organizationId, conversationId);

    if (conversation.mode === ConversationMode.Ai) {
      return this.emitUpdated(organizationId, conversationId);
    }

    const agent = await this.agents.findOne({
      where: { organizationId, isDefault: true, isActive: true },
    });

    if (!agent) {
      // Handing back to an AI that cannot run would silently strand the
      // customer with nobody answering.
      throw new ConflictException({
        code: 'AI_AGENT_NOT_CONFIGURED',
        message: 'No active AI agent is configured for this organization',
      });
    }

    await this.messages.create({
      organizationId,
      conversationId,
      senderType: MessageSenderType.System,
      content: `${user.name} ส่งการสนทนากลับให้ AI ดูแลต่อ`,
      metadata: { kind: 'return-to-ai', userId: user.id },
      conversationPatch: {
        mode: ConversationMode.Ai,
        handoffReason: null,
        handoffAt: null,
      },
    });

    return this.emitUpdated(organizationId, conversationId);
  }

  async assign(organizationId: string, conversationId: string, userId: string | null) {
    await this.conversations.updateById(organizationId, conversationId, {
      assignedUserId: userId,
    });
    return this.emitUpdated(organizationId, conversationId);
  }

  async close(organizationId: string, conversationId: string, resolution?: string) {
    await this.conversations.updateById(organizationId, conversationId, {
      status: ConversationStatus.Closed,
      closedAt: new Date(),
    });

    if (resolution) {
      await this.messages.create({
        organizationId,
        conversationId,
        senderType: MessageSenderType.System,
        content: resolution,
        metadata: { kind: 'resolution' },
      });
    }

    return this.emitUpdated(organizationId, conversationId);
  }

  async reopen(organizationId: string, conversationId: string) {
    await this.conversations.updateById(organizationId, conversationId, {
      status: ConversationStatus.Open,
      closedAt: null,
    });
    return this.emitUpdated(organizationId, conversationId);
  }

  async markRead(organizationId: string, conversationId: string) {
    await this.conversations.findByIdOrFail(organizationId, conversationId);
    await this.messages.markRead(organizationId, conversationId, 'admin');
    return this.emitUpdated(organizationId, conversationId);
  }

  private async emitUpdated(organizationId: string, conversationId: string) {
    const conversation = await this.conversations.findByIdOrFail(
      organizationId,
      conversationId,
      { customer: true, assignedUser: true },
    );
    const lastMessages = await this.lastMessageMap([conversationId]);
    const payload = toInboxItem(conversation, lastMessages.get(conversationId) ?? null);

    this.realtime.emitConversationUpdated(
      organizationId,
      conversationId,
      payload,
      toCustomerConversation(conversation),
    );
    return payload;
  }

  /**
   * Newest message per conversation, in one query.
   *
   * DISTINCT ON is the Postgres-native way to do this; the alternative is a
   * query per row, which is what makes inbox lists slow.
   */
  private async lastMessageMap(
    conversationIds: string[],
  ): Promise<Map<string, MessageEntity>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const rows = await this.messageRepo
      .createQueryBuilder('message')
      .distinctOn(['message.conversation_id'])
      .where({ conversationId: In(conversationIds) })
      .orderBy('message.conversation_id', 'DESC')
      .addOrderBy('message.created_at', 'DESC')
      .addOrderBy('message.id', 'DESC')
      .getMany();

    return new Map(rows.map((row) => [row.conversationId, row]));
  }

  async findUserForReply(organizationId: string, userId: string) {
    return this.users.findOneOrFail({ where: { id: userId, organizationId } });
  }
}
