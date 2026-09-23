import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ChannelIntegrationEntity,
  ConversationEntity,
  CustomerChannelIdentityEntity,
  CustomerEntity,
} from '../database/entities';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { MessagesService } from '../messages/messages.service';
import { RealtimeService } from '../websocket/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AiResponseQueue } from '../queue/ai-response.queue';
import {
  ChannelType,
  ConversationMode,
  ConversationStatus,
  MessageSenderType,
  NotificationType,
} from '../common/constants';
import { toCustomerMessage } from '../chat/chat.serializer';
import type { InboundMessage } from './channel-adapter.interface';

/**
 * Everything that happens to an inbound message after its signature checked
 * out — and none of it knows which provider it came from.
 *
 * This is where the phase's acceptance criterion is actually met: adding
 * WhatsApp did not change a line of this file, and nothing here reaches into
 * the orchestrator or the prompt layer.
 */
@Injectable()
export class ChannelInboundService {
  private readonly logger = new Logger(ChannelInboundService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CustomerEntity)
    private readonly customers: Repository<CustomerEntity>,
    @InjectRepository(CustomerChannelIdentityEntity)
    private readonly identities: Repository<CustomerChannelIdentityEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversationRepo: Repository<ConversationEntity>,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly aiQueue: AiResponseQueue,
  ) {}

  /**
   * Handles one verified inbound message.
   *
   * `organizationId` comes from the integration row loaded *after* the
   * signature verified — never from request context, which no guard populates
   * on a public webhook, and never from the URL, which is attacker-supplied.
   * That is the R-01 surface for this phase.
   */
  async handleMessage(
    integration: ChannelIntegrationEntity,
    inbound: InboundMessage,
  ): Promise<{ status: 'stored' | 'duplicate' }> {
    const organizationId = integration.organizationId;

    const customer = await this.resolveCustomer(organizationId, integration.channel, inbound);
    const conversation = await this.resolveConversation(
      organizationId,
      customer.id,
      integration.channel,
    );

    let created;

    try {
      created = await this.messages.create({
        organizationId,
        conversationId: conversation.id,
        senderType: MessageSenderType.Customer,
        senderId: customer.id,
        content: inbound.text,
        externalId: inbound.externalMessageId,
        metadata: inbound.replyToken ? { replyToken: inbound.replyToken } : {},
      });
    } catch (error) {
      // The partial unique index on (organization_id, external_id) caught a
      // webhook the provider retried. Returning 'duplicate' — rather than
      // letting this surface as a 500 — is what stops the retry loop: the
      // provider gets its 200 and stops resending. Critically, we also do not
      // enqueue an AI job, or a retried delivery would produce a second reply.
      if (isUniqueViolation(error)) {
        this.logger.debug({
          event: 'channel.duplicate_inbound',
          channel: integration.channel,
          externalMessageId: inbound.externalMessageId,
        });
        return { status: 'duplicate' };
      }
      throw error;
    }

    const { message, conversation: updated } = created;
    const view = toCustomerMessage(message);

    this.realtime.emitMessageToAdmins(organizationId, updated.id, {
      ...view,
      conversationId: updated.id,
      senderId: customer.id,
    });

    this.realtime.emitConversationUpdated(
      organizationId,
      updated.id,
      {
        id: updated.id,
        customer: { id: customer.id, name: customer.name, avatarUrl: customer.avatarUrl },
        status: updated.status,
        mode: updated.mode,
        lastMessage: {
          content: message.content,
          senderType: message.senderType,
          type: message.type,
          createdAt: view.createdAt,
        },
        unreadCount: updated.unreadAdminCount,
        lastMessageAt: view.createdAt,
      },
      // No customer-side payload: an external customer is not on our socket.
      null,
    );

    if (updated.assignedUserId) {
      void this.notifications.notify({
        organizationId,
        userId: updated.assignedUserId,
        type: NotificationType.NewMessage,
        title: 'ข้อความใหม่',
        message: `${customer.name ?? 'ลูกค้า'}: ${inbound.text.slice(0, 80)}`,
        conversationId: updated.id,
      });
    }

    if (updated.mode === ConversationMode.Ai) {
      await this.aiQueue.enqueue({
        organizationId,
        conversationId: updated.id,
        triggerMessageId: message.id,
      });
    }

    return { status: 'stored' };
  }

  /**
   * Finds the customer behind a provider user id, creating both the customer
   * and the identity mapping on first contact.
   *
   * Done in a transaction with an upsert rather than find-then-insert: two
   * webhooks for a first-time customer can arrive concurrently (providers
   * batch and retry), and the naive form creates two customers for one person.
   */
  private async resolveCustomer(
    organizationId: string,
    channel: ChannelType,
    inbound: InboundMessage,
  ): Promise<CustomerEntity> {
    const existing = await this.identities.findOne({
      where: { organizationId, channel, externalUserId: inbound.externalUserId },
    });

    if (existing) {
      const customer = await this.customers.findOne({
        where: { id: existing.customerId, organizationId },
      });
      if (customer) return customer;
    }

    return this.dataSource.transaction(async (manager) => {
      const identities = manager.getRepository(CustomerChannelIdentityEntity);
      const customers = manager.getRepository(CustomerEntity);

      const customer = await customers.save(
        customers.create({
          organizationId,
          name: inbound.displayName ?? null,
          metadata: { channel, externalUserId: inbound.externalUserId },
          tags: [],
        }),
      );

      // ON CONFLICT DO NOTHING, then re-read: if a concurrent webhook won the
      // race, its customer is the real one and the row created above is
      // orphaned rather than duplicated into the conversation.
      await identities
        .createQueryBuilder()
        .insert()
        .values({
          organizationId,
          customerId: customer.id,
          channel,
          externalUserId: inbound.externalUserId,
          displayName: inbound.displayName ?? null,
        })
        .orIgnore()
        .execute();

      const winner = await identities.findOneOrFail({
        where: { organizationId, channel, externalUserId: inbound.externalUserId },
      });

      if (winner.customerId === customer.id) {
        return customer;
      }

      await customers.delete({ id: customer.id });
      return customers.findOneOrFail({ where: { id: winner.customerId, organizationId } });
    });
  }

  /**
   * The conversation this message belongs to.
   *
   * Same resume rule as the web widget (TD-09): an OPEN or PENDING
   * conversation is resumed, a CLOSED one is not reopened — a new
   * conversation is started, because closed means resolved.
   */
  private async resolveConversation(
    organizationId: string,
    customerId: string,
    channel: ChannelType,
  ): Promise<ConversationEntity> {
    const active = await this.conversations.findActiveForCustomer(organizationId, customerId);

    if (active) {
      return active;
    }

    const conversation = await this.conversationRepo.save(
      this.conversationRepo.create({
        organizationId,
        customerId,
        status: ConversationStatus.Open,
        mode: ConversationMode.Ai,
        channel,
      }),
    );

    const customer = await this.customers.findOne({ where: { id: customerId } });

    void this.notifications.notify({
      organizationId,
      type: NotificationType.NewConversation,
      title: 'การสนทนาใหม่',
      message: `${customer?.name ?? 'ลูกค้า'} เริ่มการสนทนาใหม่ทาง ${channel.toUpperCase()}`,
      conversationId: conversation.id,
    });

    this.realtime.emitConversationNew(organizationId, {
      id: conversation.id,
      customer: customer
        ? { id: customer.id, name: customer.name, avatarUrl: customer.avatarUrl }
        : null,
      status: conversation.status,
      mode: conversation.mode,
      channel: conversation.channel,
      assignedUser: null,
      lastMessage: null,
      unreadCount: 0,
      lastMessageAt: null,
      createdAt: conversation.createdAt.toISOString(),
    });

    return conversation;
  }
}

/** Postgres unique-violation SQLSTATE. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
