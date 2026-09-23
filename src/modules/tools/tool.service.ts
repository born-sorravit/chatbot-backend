import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import {
  AiAgentToolEntity,
  AiToolEntity,
  ToolExecutionEntity,
} from '@/models/entities';
import { ToolExecutionStatus } from '@/shared/constants';
import { AuditService } from '@/modules/audit/audit.service';
import { GetOrderStatusTool } from './registry/get-order-status.tool';
import { GetProductStockTool } from './registry/get-product-stock.tool';
import { GetProductTool } from './registry/get-product.tool';
import type { AITool, ToolContext } from './tool.interface';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ToolResult =
  | { ok: true; output: unknown; executionId: string }
  | { ok: false; error: string; executionId: string | null; pendingApproval?: boolean };

@Injectable()
export class ToolService {
  private readonly logger = new Logger(ToolService.name);

  /**
   * The code registry — the only place a capability can come from.
   *
   * A database row cannot introduce a tool: an `ai_tools` row whose name is
   * absent here resolves to nothing and the call is rejected. That is what
   * §25's "no arbitrary API access" means concretely.
   */
  private readonly registry: Map<string, AITool>;

  constructor(
    getProduct: GetProductTool,
    getProductStock: GetProductStockTool,
    getOrderStatus: GetOrderStatusTool,
    private readonly audit: AuditService,
    @InjectRepository(AiToolEntity)
    private readonly tools: Repository<AiToolEntity>,
    @InjectRepository(AiAgentToolEntity)
    private readonly agentTools: Repository<AiAgentToolEntity>,
    @InjectRepository(ToolExecutionEntity)
    private readonly executions: Repository<ToolExecutionEntity>,
  ) {
    this.registry = new Map(
      [getProduct, getProductStock, getOrderStatus].map((tool) => [tool.name, tool as AITool]),
    );
  }

  /** Every tool the code knows about, regardless of org or agent. */
  allRegistered(): AITool[] {
    return [...this.registry.values()];
  }

  /**
   * JSON Schema for the tools this agent may use, ready to hand to the model.
   *
   * Derived from each tool's Zod schema rather than stored separately, so the
   * advertised contract and the enforced one are the same object.
   */
  async definitionsForAgent(organizationId: string, aiAgentId: string): Promise<ToolDefinition[]> {
    const allowed = await this.allowedToolsFor(organizationId, aiAgentId);

    return allowed.flatMap(({ row }) => {
      const tool = this.registry.get(row.name);
      if (!tool) return [];

      return [
        {
          name: tool.name,
          description: row.description || tool.description,
          inputSchema: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
        },
      ];
    });
  }

  /**
   * The execution path (docs/ARCHITECTURE.md §8.2).
   *
   *   registry lookup → agent allowlist → Zod validation →
   *   approval gate → execute → log
   *
   * Every rejection returns a structured error *to the model*, never an
   * exception to the customer: the model can then say it could not retrieve
   * the information, which is the honest answer.
   */
  async execute(
    organizationId: string,
    aiAgentId: string,
    toolName: string,
    rawInput: unknown,
    context: ToolContext,
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolName);

    if (!tool) {
      await this.log(organizationId, context, toolName, null, rawInput, {
        status: ToolExecutionStatus.Failed,
        errorMessage: 'Unknown tool',
      });
      return { ok: false, error: `Unknown tool: ${toolName}`, executionId: null };
    }

    const allowed = (await this.allowedToolsFor(organizationId, aiAgentId)).find(
      (entry) => entry.row.name === toolName,
    );

    if (!allowed) {
      // The core guarantee of §25. Logged because "the AI tried to call a
      // tool it was not allowed to" is exactly the event worth finding later.
      const execution = await this.log(organizationId, context, toolName, null, rawInput, {
        status: ToolExecutionStatus.Rejected,
        errorMessage: 'Tool is not enabled for this agent',
      });

      this.logger.warn({
        event: 'tool.not_permitted',
        organizationId,
        aiAgentId,
        toolName,
      });

      return {
        ok: false,
        error: `Tool "${toolName}" is not available.`,
        executionId: execution.id,
      };
    }

    const parsed = tool.inputSchema.safeParse(rawInput);

    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`)
        .join('; ');

      const execution = await this.log(organizationId, context, toolName, allowed.row.id, rawInput, {
        status: ToolExecutionStatus.Failed,
        errorMessage: `Invalid input — ${detail}`,
      });

      // Returned to the model so it can correct the arguments and retry,
      // rather than failing the whole turn.
      return { ok: false, error: `Invalid input: ${detail}`, executionId: execution.id };
    }

    if (tool.mutating || allowed.link.requiresApproval) {
      const execution = await this.log(organizationId, context, toolName, allowed.row.id, parsed.data, {
        status: ToolExecutionStatus.PendingApproval,
      });

      this.logger.log({
        event: 'tool.pending_approval',
        organizationId,
        toolName,
        executionId: execution.id,
      });

      return {
        ok: false,
        error: 'This action needs approval from a staff member before it can run.',
        executionId: execution.id,
        pendingApproval: true,
      };
    }

    const startedAt = Date.now();

    try {
      const output = await tool.execute(parsed.data, context);
      const durationMs = Date.now() - startedAt;

      const execution = await this.log(organizationId, context, toolName, allowed.row.id, parsed.data, {
        status: ToolExecutionStatus.Success,
        output: output as Record<string, unknown>,
        durationMs,
      });

      await this.audit.record({
        organizationId,
        actorType: 'AI',
        action: 'tool.execute',
        resourceType: 'tool_execution',
        resourceId: execution.id,
        changes: { toolName, durationMs },
      });

      this.logger.log({
        event: 'tool.executed',
        organizationId,
        toolName,
        durationMs,
        conversationId: context.conversationId,
      });

      return { ok: true, output, executionId: execution.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      const execution = await this.log(organizationId, context, toolName, allowed.row.id, parsed.data, {
        status: ToolExecutionStatus.Failed,
        errorMessage: message.slice(0, 500),
        durationMs: Date.now() - startedAt,
      });

      this.logger.error({ event: 'tool.failed', organizationId, toolName, message });

      // The internal message never reaches the model — it could contain
      // connection strings or row data.
      return {
        ok: false,
        error: 'The tool failed to run. Tell the customer you could not retrieve this.',
        executionId: execution.id,
      };
    }
  }

  private async allowedToolsFor(
    organizationId: string,
    aiAgentId: string,
  ): Promise<{ row: AiToolEntity; link: AiAgentToolEntity }[]> {
    const links = await this.agentTools.find({
      where: { organizationId, aiAgentId, enabled: true },
    });

    if (links.length === 0) {
      return [];
    }

    const rows = await this.tools.find({
      where: links.map((link) => ({ id: link.aiToolId, organizationId, isActive: true })),
    });

    return rows.flatMap((row) => {
      const link = links.find((candidate) => candidate.aiToolId === row.id);
      return link ? [{ row, link }] : [];
    });
  }

  private async log(
    organizationId: string,
    context: ToolContext,
    toolName: string,
    aiToolId: string | null,
    input: unknown,
    fields: Partial<ToolExecutionEntity>,
  ): Promise<ToolExecutionEntity> {
    return this.executions.save(
      this.executions.create({
        organizationId,
        conversationId: context.conversationId,
        aiToolId,
        toolName,
        input: (input ?? {}) as Record<string, unknown>,
        ...fields,
      }),
    );
  }
}
