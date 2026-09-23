import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE, aiResponseJobId } from '../common/constants';

export interface AiResponseJobData {
  organizationId: string;
  conversationId: string;
  triggerMessageId: string;
}

@Injectable()
export class AiResponseQueue {
  private readonly logger = new Logger(AiResponseQueue.name);

  constructor(
    @InjectQueue(QUEUE.AiResponse) private readonly queue: Queue<AiResponseJobData>,
  ) {}

  /**
   * Enqueues a reply job.
   *
   * The job id is derived from the message id (TD-10), so a duplicate
   * enqueue — double submit, retried request, at-least-once delivery — is
   * dropped by BullMQ instead of producing a second reply the customer can
   * see.
   *
   * Never throws: a queue outage must not fail the customer's send. The
   * message is already stored and visible to admins; losing the AI reply is
   * the smaller failure.
   */
  async enqueue(data: AiResponseJobData): Promise<boolean> {
    try {
      await this.queue.add('generate', data, {
        jobId: aiResponseJobId(data.triggerMessageId),
      });
      return true;
    } catch (error) {
      this.logger.error({
        event: 'ai.enqueue_failed',
        conversationId: data.conversationId,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
