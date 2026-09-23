import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { IngestionService } from '@/modules/documents/ingestion.service';
import { QUEUE } from '@/shared/constants';
import type { IngestionJobData } from '@/modules/queue/knowledge-ingestion.queue';

@Processor(QUEUE.KnowledgeIngestion)
export class KnowledgeIngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(KnowledgeIngestionProcessor.name);

  constructor(private readonly ingestion: IngestionService) {
    super();
  }

  async process(job: Job<IngestionJobData>): Promise<void> {
    const { organizationId, documentId } = job.data;

    const result = await this.ingestion.ingest(organizationId, documentId);

    this.logger.log({
      event: 'kb.job_finished',
      jobId: job.id,
      documentId,
      chunks: result.chunkCount,
    });
  }

  /**
   * IngestionService already writes FAILED with a human-readable reason, so
   * there is nothing to repair here — this only records that the retries are
   * spent, which the document row alone would not show.
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<IngestionJobData> | undefined, error: Error): void {
    this.logger.error({
      event: 'kb.job_failed',
      jobId: job?.id,
      documentId: job?.data?.documentId,
      attempt: job?.attemptsMade,
      message: error.message,
    });
  }
}
