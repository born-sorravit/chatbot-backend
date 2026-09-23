import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE, channelDeliveryJobId } from '../common/constants';

export interface ChannelDeliveryJobData {
  organizationId: string;
  conversationId: string;
  messageId: string;
}

@Injectable()
export class ChannelDeliveryQueue {
  private readonly logger = new Logger(ChannelDeliveryQueue.name);

  constructor(
    @InjectQueue(QUEUE.ChannelDelivery) private readonly queue: Queue<ChannelDeliveryJobData>,
  ) {}

  /**
   * Enqueues one outbound delivery.
   *
   * Job id derived from the message id (TD-10), so a duplicate enqueue cannot
   * send the customer the same LINE message twice.
   *
   * Never throws, for the same reason `AiResponseQueue.enqueue` doesn't: the
   * message is already committed and visible to admins, and a Redis blip must
   * not turn into a failed reply or a rolled-back write.
   */
  async enqueue(data: ChannelDeliveryJobData): Promise<boolean> {
    try {
      await this.queue.add('send', data, { jobId: channelDeliveryJobId(data.messageId) });
      return true;
    } catch (error) {
      this.logger.error({
        event: 'channel.enqueue_failed',
        conversationId: data.conversationId,
        messageId: data.messageId,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
