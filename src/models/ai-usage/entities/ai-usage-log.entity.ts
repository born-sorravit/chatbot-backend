import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Per-request AI cost and latency (master plan §44).
 *
 * Written from Phase 3, not Phase 7: cost data cannot be backfilled — if it
 * is not captured at request time it is gone, and the first surprising
 * invoice is the wrong moment to discover that.
 */
@Entity({ name: 'ai_usage_logs' })
@Index('ix_usage_org_created', ['organizationId', 'createdAt'])
export class AiUsageLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId!: string | null;

  /** 'response' | 'summary' | 'embedding' */
  @Column({ type: 'varchar', length: 32 })
  purpose!: string;

  @Column({ type: 'varchar', length: 64 })
  provider!: string;

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({ name: 'input_tokens', type: 'int', default: 0 })
  inputTokens!: number;

  @Column({ name: 'output_tokens', type: 'int', default: 0 })
  outputTokens!: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens!: number;

  /**
   * numeric, not float: per-request costs are fractions of a cent and
   * floating-point money is a bug that surfaces in a customer-facing total.
   */
  @Column({
    name: 'estimated_cost_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    default: 0,
  })
  estimatedCostUsd!: string;

  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs!: number;

  @Column({ type: 'boolean', default: true })
  success!: boolean;

  @Column({ name: 'error_code', type: 'varchar', length: 100, nullable: true })
  errorCode!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
