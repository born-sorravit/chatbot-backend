import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { AiToolEntity, ToolExecutionEntity } from '../database/entities';
import { ToolExecutionStatus } from '../common/constants';
import { AuditService } from '../audit/audit.service';
import { ToolService } from './tool.service';
import type { ListExecutionsDto } from './tools.controller';

@Injectable()
export class ToolsAdminService {
  constructor(
    private readonly tools: ToolService,
    private readonly audit: AuditService,
    @InjectRepository(AiToolEntity)
    private readonly toolRows: Repository<AiToolEntity>,
    @InjectRepository(ToolExecutionEntity)
    private readonly executions: Repository<ToolExecutionEntity>,
  ) {}

  list(organizationId: string) {
    return this.toolRows.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  /**
   * Ensures every registered tool has a row for this organization.
   *
   * Registration is idempotent and derives the schema from code, so adding a
   * tool to the registry makes it available without a migration — while a row
   * for a tool the code does not implement still cannot be called.
   */
  async syncRegistry(organizationId: string): Promise<AiToolEntity[]> {
    const registered = this.tools.allRegistered();

    for (const tool of registered) {
      const existing = await this.toolRows.findOne({
        where: { organizationId, name: tool.name },
      });

      const inputSchema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;

      if (existing) {
        // Schema and mutating flag come from code and are refreshed; the
        // description is left alone because admins may have tuned it.
        existing.inputSchema = inputSchema;
        existing.mutating = tool.mutating;
        await this.toolRows.save(existing);
      } else {
        await this.toolRows.save(
          this.toolRows.create({
            organizationId,
            name: tool.name,
            description: tool.description,
            inputSchema,
            mutating: tool.mutating,
            isActive: true,
          }),
        );
      }
    }

    return this.list(organizationId);
  }

  listExecutions(organizationId: string, query: ListExecutionsDto) {
    return this.executions.find({
      where: {
        organizationId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.conversationId ? { conversationId: query.conversationId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit,
    });
  }

  async approve(organizationId: string, executionId: string, userId: string) {
    const execution = await this.requirePending(organizationId, executionId);

    execution.status = ToolExecutionStatus.Approved;
    execution.approvedByUserId = userId;
    await this.executions.save(execution);

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'tool.approve',
      resourceType: 'tool_execution',
      resourceId: executionId,
      changes: { toolName: execution.toolName },
    });

    return execution;
  }

  async reject(organizationId: string, executionId: string, userId: string, reason?: string) {
    const execution = await this.requirePending(organizationId, executionId);

    execution.status = ToolExecutionStatus.Rejected;
    execution.approvedByUserId = userId;
    execution.errorMessage = reason ?? 'Rejected by an administrator';
    await this.executions.save(execution);

    await this.audit.record({
      organizationId,
      actorType: 'USER',
      actorId: userId,
      action: 'tool.reject',
      resourceType: 'tool_execution',
      resourceId: executionId,
      changes: { toolName: execution.toolName, reason },
    });

    return execution;
  }

  private async requirePending(
    organizationId: string,
    executionId: string,
  ): Promise<ToolExecutionEntity> {
    const execution = await this.executions.findOne({
      where: { id: executionId, organizationId },
    });

    if (!execution) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Tool execution not found',
      });
    }

    if (execution.status !== ToolExecutionStatus.PendingApproval) {
      // Approving an already-decided call would misrepresent the audit trail.
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Tool execution is ${execution.status}, not awaiting approval`,
      });
    }

    return execution;
  }
}
