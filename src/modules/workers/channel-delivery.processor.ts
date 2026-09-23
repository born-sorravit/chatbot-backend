import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '@/shared/constants';
import { ChannelDeliveryService } from '@/modules/channels/channel-delivery.service';
import type { ChannelDeliveryJobData } from '@/modules/queue/channel-delivery.queue';

/**
 * Delivers AI and admin replies to external channels.
 *
 * Failures are rethrown so BullMQ applies the configured backoff: a provider
 * outage should cost a few retries, not a customer who never hears back.
 */
@Processor(QUEUE.ChannelDelivery)
export class ChannelDeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(ChannelDeliveryProcessor.name);

  constructor(private readonly delivery: ChannelDeliveryService) {
    super();
  }

  async process(job: Job<ChannelDeliveryJobData>): Promise<void> {
    const { organizationId, messageId } = job.data;

    const result = await this.delivery.deliver(organizationId, messageId);

    this.logger.log({
      event: 'channel.delivery',
      messageId,
      status: result.status,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  }
}
