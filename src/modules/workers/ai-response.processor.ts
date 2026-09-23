import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AiOrchestrator } from '@/modules/ai/orchestrator/ai-orchestrator.service';
import { ConversationsRepository } from '@/models/conversations/conversations.repository';
import { MessagesService } from '@/modules/messages/messages.service';
import { RealtimeService } from '@/modules/websocket/realtime.service';
import { toCustomerMessage } from '@/modules/chat/chat.serializer';
import { toAdminMessage, toInboxItem } from '@/modules/conversations/conversations.serializer';
import {
  ConversationMode,
  HandoffReason,
  MessageSenderType,
  NotificationType,
  QUEUE,
} from '@/shared/constants';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import type { AiResponseJobData } from '@/modules/queue/ai-response.queue';

/**
 * What the customer sees when the AI path fails for good (master plan §41).
 *
 * Never an error code or a stack — the customer gets an apology and a human.
 */
const FALLBACK_MESSAGE =
  'ขออภัยครับ ตอนนี้ระบบกำลังมีปัญหา ผมกำลังส่งเรื่องให้ทีมงานช่วยดูให้นะครับ';

@Processor(QUEUE.AiResponse)
export class AiResponseProcessor extends WorkerHost {
  private readonly logger = new Logger(AiResponseProcessor.name);

  constructor(
    private readonly orchestrator: AiOrchestrator,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<AiResponseJobData>): Promise<void> {
    const { organizationId, conversationId, triggerMessageId } = job.data;

    this.logger.log({
      event: 'ai.job_started',
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      organizationId,
      conversationId,
    });

    const outcome = await this.orchestrator.handle({
      organizationId,
      conversationId,
      triggerMessageId,
    });

    this.logger.log({
      event: 'ai.job_finished',
      jobId: job.id,
      organizationId,
      conversationId,
      outcome: outcome.status,
    });
  }

  /**
   * Final failure, after every retry is spent (master plan §41).
   *
   * The customer must not be left waiting on a reply that will never come:
   * post the apology, flip to HUMAN so an admin picks it up, and record the
   * reason. Only runs on the last attempt — earlier failures are retries.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiResponseJobData> | undefined, error: Error): Promise<void> {
    if (!job) {
      return;
    }

    const attemptsAllowed = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attemptsAllowed;

    this.logger.error({
      event: 'ai.job_failed',
      jobId: job.id,
      attempt: job.attemptsMade,
      exhausted,
      message: error.message,
    });

    if (!exhausted) {
      return;
    }

    const { organizationId, conversationId, triggerMessageId } = job.data;

    try {
      const conversation = await this.conversations.findById(organizationId, conversationId);

      // An admin may have taken over while the retries were burning down;
      // in that case they own the thread and nothing more is needed.
      if (!conversation || conversation.mode !== ConversationMode.Ai) {
        return;
      }

      const { message, conversation: updated } = await this.messages.create({
        organizationId,
        conversationId,
        senderType: MessageSenderType.Ai,
        content: FALLBACK_MESSAGE,
        triggerMessageId,
        metadata: { handoffNote: `provider failure: ${error.message}` },
        conversationPatch: {
          mode: ConversationMode.Human,
          handoffReason: HandoffReason.ProviderError,
          handoffAt: new Date(),
        },
      });

      this.realtime.emitMessageToCustomer(
        conversationId,
        toCustomerMessage(message),
      );
      this.realtime.emitMessageToAdmins(
        organizationId,
        conversationId,
        toAdminMessage(message),
      );
      this.realtime.emitConversationUpdated(
        organizationId,
        conversationId,
        toInboxItem(updated, message),
        null,
      );
      this.realtime.emitAiHandoff(
        organizationId,
        conversationId,
        HandoffReason.ProviderError,
      );

      await this.notifications.notify({
        organizationId,
        type: NotificationType.AiHandoff,
        title: 'ระบบ AI ขัดข้อง',
        message: 'AI ตอบไม่สำเร็จหลังลองใหม่หลายครั้ง — ส่งต่อให้แอดมินแล้ว',
        conversationId,
        metadata: { reason: HandoffReason.ProviderError },
      });
    } catch (fallbackError) {
      // Nothing left to try. Log loudly — a customer is now waiting on a
      // reply that will not arrive.
      this.logger.error({
        event: 'ai.fallback_failed',
        jobId: job.id,
        message:
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
    }
  }
}
