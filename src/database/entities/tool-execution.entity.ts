import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ToolExecutionStatus } from '../../common/constants';

/**
 * Audit trail for every tool call (master plan §25).
 *
 * Written for rejections too, not just successes: "the AI tried to call a tool
 * it was not allowed to" is exactly the event worth being able to find later.
 */
@Entity({ name: 'tool_executions' })
@Index('ix_toolexec_org_created', ['organizationId', 'createdAt'])
export class ToolExecutionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;

  @Column({ name: 'message_id', type: 'uuid', nullable: true })
  messageId!: string | null;

  @Column({ name: 'ai_tool_id', type: 'uuid', nullable: true })
  aiToolId!: string | null;

  /**
   * Copied rather than joined, so the audit trail still reads correctly after
   * a tool is renamed or removed. An audit trail that depends on current
   * state is not an audit trail.
   */
  @Column({ name: 'tool_name', type: 'varchar', length: 100 })
  toolName!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  input!: Record<string, unknown>;

  @Column({ type: 'jsonb', nullable: true })
  output!: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: ToolExecutionStatus,
    enumName: 'tool_exec_status',
    default: ToolExecutionStatus.Running,
  })
  status!: ToolExecutionStatus;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId!: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
