import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiUsageLogEntity } from '@/models/entities';

export interface UsageRecord {
  organizationId: string;
  conversationId?: string | null;
  messageId?: string | null;
  purpose: 'response' | 'summary' | 'embedding';
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string | null;
}

/** AI cost and latency tracking (master plan §44). */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectRepository(AiUsageLogEntity)
    private readonly logs: Repository<AiUsageLogEntity>,
  ) {}

  /**
   * Never throws.
   *
   * Usage logging is observability, not the request path — failing to record
   * a cost row must not turn a successful customer reply into an error.
   */
  async record(record: UsageRecord): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          organizationId: record.organizationId,
          conversationId: record.conversationId ?? null,
          messageId: record.messageId ?? null,
          purpose: record.purpose,
          provider: record.provider,
          model: record.model,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          totalTokens: record.inputTokens + record.outputTokens,
          estimatedCostUsd: record.estimatedCostUsd.toFixed(6),
          latencyMs: record.latencyMs,
          success: record.success,
          errorCode: record.errorCode ?? null,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to record AI usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
