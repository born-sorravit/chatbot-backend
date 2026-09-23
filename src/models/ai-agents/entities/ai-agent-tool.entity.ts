import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * The allowlist (master plan §25).
 *
 * **A tool absent from this table cannot be called, ever.** This is the whole
 * security model for tool access: the registry says what exists, this says
 * what a given agent may reach.
 */
@Entity({ name: 'ai_agent_tools' })
export class AiAgentToolEntity {
  @PrimaryColumn({ name: 'ai_agent_id', type: 'uuid' })
  aiAgentId!: string;

  @PrimaryColumn({ name: 'ai_tool_id', type: 'uuid' })
  aiToolId!: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /**
   * Lets an organization demand human sign-off on a tool that is otherwise
   * non-mutating — a read that exposes sensitive data, for example.
   */
  @Column({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval!: boolean;
}
