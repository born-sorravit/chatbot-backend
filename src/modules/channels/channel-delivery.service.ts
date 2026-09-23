import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ChannelIntegrationEntity,
  ConversationEntity,
  CustomerChannelIdentityEntity,
  MessageEntity,
} from '@/models/entities';
import { ChannelRegistry } from './channel-registry.service';
import { ChannelDeliveryStatus, ChannelType, isExternalChannel } from '@/shared/constants';

export interface DeliveryResult {
  status: ChannelDeliveryStatus;
  reason?: string;
}

/**
 * Pushes one stored message out to the customer's provider.
 *
 * Split from the BullMQ processor so the logic is callable — and testable —
 * without a queue running.
 */
@Injectable()
export class ChannelDeliveryService {
  private readonly logger = new Logger(ChannelDeliveryService.name);

  constructor(
    @InjectRepository(MessageEntity)
    private readonly messages: Repository<MessageEntity>,
    @InjectRepository(ConversationEntity)
    private readonly conversations: Repository<ConversationEntity>,
    @InjectRepository(ChannelIntegrationEntity)
    private readonly integrations: Repository<ChannelIntegrationEntity>,
    @InjectRepository(CustomerChannelIdentityEntity)
    private readonly identities: Repository<CustomerChannelIdentityEntity>,
    private readonly registry: ChannelRegistry,
  ) {}

  async deliver(organizationId: string, messageId: string): Promise<DeliveryResult> {
    const message = await this.messages.findOne({ where: { id: messageId, organizationId } });

    if (!message || !message.content) {
      return { status: ChannelDeliveryStatus.Skipped, reason: 'message not found or empty' };
    }

    const conversation = await this.conversations.findOne({
      where: { id: message.conversationId, organizationId },
    });

    if (!conversation || !isExternalChannel(conversation.channel)) {
      return { status: ChannelDeliveryStatus.Skipped, reason: 'not an external channel' };
    }

    const channel = conversation.channel as ChannelType;

    const integration = await this.integrations.findOne({
      where: { organizationId, channel, isActive: true },
    });

    if (!integration) {
      // Not an error worth retrying: the admin disconnected the channel, or
      // never finished connecting it. Retrying would burn the backoff budget
      // on something only a human can fix.
      return { status: ChannelDeliveryStatus.Skipped, reason: 'no active integration' };
    }

    const identity = await this.identities.findOne({
      where: { organizationId, channel, customerId: conversation.customerId },
    });

    if (!identity) {
      return { status: ChannelDeliveryStatus.Skipped, reason: 'customer has no channel identity' };
    }

    const adapter = this.registry.get(channel);

    // The reply token, if the inbound message that triggered this reply
    // carried one. Free where push is billed, so it is worth threading
    // through — but it expires, hence the adapter's push fallback.
    const replyToken = await this.replyTokenFor(message);

    try {
      await adapter.send(integration.credentials, {
        externalUserId: identity.externalUserId,
        text: message.content,
        replyToken,
      });

      if (integration.lastError) {
        await this.integrations.update({ id: integration.id }, { lastError: null });
      }

      return { status: ChannelDeliveryStatus.Delivered };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      // Surfaced on the integration so an admin can see a broken channel in
      // the UI instead of wondering why customers stopped replying.
      await this.integrations.update({ id: integration.id }, { lastError: reason.slice(0, 500) });

      this.logger.error({
        event: 'channel.delivery_failed',
        channel,
        messageId,
        message: reason,
      });

      // Rethrown so BullMQ retries with backoff — a provider 500 is exactly
      // what the retry budget is for.
      throw error;
    }
  }

  /**
   * LINE's per-message reply token, stored on the inbound message that
   * triggered this reply.
   *
   * Only meaningful for an AI reply, which carries `triggerMessageId`. An
   * admin typing into the inbox minutes later has no token and correctly
   * falls through to push.
   */
  private async replyTokenFor(message: MessageEntity): Promise<string | null> {
    if (!message.triggerMessageId) {
      return null;
    }

    const trigger = await this.messages.findOne({
      where: { id: message.triggerMessageId, organizationId: message.organizationId },
    });

    const token = trigger?.metadata?.replyToken;
    return typeof token === 'string' ? token : null;
  }
}
