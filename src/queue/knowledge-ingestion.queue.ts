import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE, ingestionJobId } from '../common/constants';

export interface IngestionJobData {
  organizationId: string;
  knowledgeBaseId: string;
  documentId: string;
}

@Injectable()
export class KnowledgeIngestionQueue {
  private readonly logger = new Logger(KnowledgeIngestionQueue.name);

  constructor(
    @InjectQueue(QUEUE.KnowledgeIngestion)
    private readonly queue: Queue<IngestionJobData>,
  ) {}

  /**
   * Queues a document for extraction, chunking and embedding.
   *
   * Unlike the AI queue this *does* throw: a document whose ingest job never
   * lands would sit at PENDING forever with no explanation, so the caller
   * needs to know and mark it FAILED.
   */
  async enqueue(data: IngestionJobData): Promise<void> {
    await this.queue.add('ingest', data, {
      jobId: ingestionJobId(data.documentId, Date.now()),
    });

    this.logger.log({ event: 'kb.ingest_enqueued', documentId: data.documentId });
  }
}
