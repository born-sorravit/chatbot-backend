import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Not } from 'typeorm';
import {
  AiAgentEntity,
  AiAgentKnowledgeBaseEntity,
  AiAgentToolEntity,
  AiToolEntity,
  KnowledgeBaseEntity,
} from '@/models/entities';
import { AiAgentsRepository } from '@/models/ai-agents/ai-agents.repository';
import { DEFAULT_LLM_MODEL } from '@/shared/constants';
import { DEFAULT_SYSTEM_PROMPT } from '@/modules/ai/prompts/prompt.service';
import type { CreateAiAgentDto, UpdateAiAgentDto } from './dto';

@Injectable()
export class AiAgentsService {
  constructor(
    private readonly agents: AiAgentsRepository,
    private readonly dataSource: DataSource,
  ) {}

  async list(organizationId: string) {
    const agents = await this.agents.findMany(organizationId, { order: { createdAt: 'ASC' } });
    return Promise.all(agents.map((agent) => this.withKnowledgeBases(organizationId, agent)));
  }

  async findById(organizationId: string, id: string) {
    return this.withKnowledgeBases(
      organizationId,
      await this.agents.findByIdOrFail(organizationId, id),
    );
  }

  /**
   * Attaches linked knowledge base ids.
   *
   * Exposed on the agent rather than as a separate endpoint because the admin
   * form edits them together — §37 treats the KB selection as part of the
   * agent's configuration.
   */
  private async withKnowledgeBases(
    organizationId: string,
    agent: AiAgentEntity,
  ): Promise<AiAgentEntity & { knowledgeBaseIds: string[] }> {
    const links = await this.dataSource.getRepository(AiAgentKnowledgeBaseEntity).find({
      where: { organizationId, aiAgentId: agent.id },
    });

    const toolLinks = await this.dataSource.getRepository(AiAgentToolEntity).find({
      where: { organizationId, aiAgentId: agent.id, enabled: true },
    });

    return Object.assign(agent, {
      knowledgeBaseIds: links.map((l) => l.knowledgeBaseId),
      toolIds: toolLinks.map((l) => l.aiToolId),
    });
  }

  /**
   * Replaces an agent's tool allowlist inside the caller's transaction.
   *
   * Ownership is verified first: without it, a crafted request could grant an
   * agent a tool belonging to another organization, and tool execution would
   * then run against whatever that tool reaches.
   */
  private async replaceToolLinks(
    manager: EntityManager,
    organizationId: string,
    aiAgentId: string,
    toolIds: string[] | undefined,
  ): Promise<void> {
    if (!toolIds) {
      return;
    }

    const unique = [...new Set(toolIds)];

    if (unique.length > 0) {
      const owned = await manager.getRepository(AiToolEntity).find({
        where: unique.map((id) => ({ id, organizationId })),
        select: { id: true },
      });

      if (owned.length !== unique.length) {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'One or more tools were not found',
        });
      }
    }

    const links = manager.getRepository(AiAgentToolEntity);
    await links.delete({ aiAgentId, organizationId });

    if (unique.length > 0) {
      await links.insert(
        unique.map((aiToolId) => ({ aiAgentId, aiToolId, organizationId, enabled: true })),
      );
    }
  }

  /**
   * Replaces an agent's knowledge base links inside the caller's transaction.
   *
   * Every id is verified to belong to this organization first — otherwise a
   * crafted request could link an agent to another tenant's knowledge and
   * exfiltrate it through ordinary chat (R-01).
   */
  private async replaceKnowledgeBaseLinks(
    manager: EntityManager,
    organizationId: string,
    aiAgentId: string,
    knowledgeBaseIds: string[] | undefined,
  ): Promise<void> {
    if (!knowledgeBaseIds) {
      return;
    }

    const unique = [...new Set(knowledgeBaseIds)];

    if (unique.length > 0) {
      const owned = await manager.getRepository(KnowledgeBaseEntity).find({
        where: unique.map((id) => ({ id, organizationId })),
        select: { id: true },
      });

      if (owned.length !== unique.length) {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'One or more knowledge bases were not found',
        });
      }
    }

    const links = manager.getRepository(AiAgentKnowledgeBaseEntity);
    await links.delete({ aiAgentId, organizationId });

    if (unique.length > 0) {
      await links.insert(
        unique.map((knowledgeBaseId) => ({ aiAgentId, knowledgeBaseId, organizationId })),
      );
    }
  }

  async create(organizationId: string, dto: CreateAiAgentDto) {
    const created = await this.dataSource.transaction(async (manager) => {
      await this.demoteOtherDefaults(manager, organizationId, dto.isDefault);

      const repository = manager.getRepository(AiAgentEntity);
      const { knowledgeBaseIds, toolIds, ...fields } = dto;

      const agent = await repository.save(
        repository.create({
          ...fields,
          organizationId,
          systemPrompt: dto.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          model: dto.model ?? DEFAULT_LLM_MODEL,
        }),
      );

      await this.replaceKnowledgeBaseLinks(manager, organizationId, agent.id, knowledgeBaseIds);
      await this.replaceToolLinks(manager, organizationId, agent.id, toolIds);

      return agent.id;
    });

    // Re-read rather than returning what save() handed back: TypeORM's save
    // returns only the columns it touched, so a patch that changed nothing on
    // the entity itself came back missing name, systemPrompt and the rest.
    return this.findById(organizationId, created);
  }

  async update(organizationId: string, id: string, dto: UpdateAiAgentDto) {
    await this.dataSource.transaction(async (manager) => {
      await this.demoteOtherDefaults(manager, organizationId, dto.isDefault, id);

      const repository = manager.getRepository(AiAgentEntity);

      const agent = await repository.findOne({ where: { id, organizationId } });

      if (!agent) {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'AI agent not found',
        });
      }

      // organizationId and id are never patchable — a DTO must not be able
      // to move an agent between tenants. knowledgeBaseIds is not a column.
      const {
        organizationId: _org,
        id: _id,
        knowledgeBaseIds,
        toolIds,
        ...safe
      } = dto as Record<string, unknown> & { knowledgeBaseIds?: string[]; toolIds?: string[] };
      Object.assign(agent, safe);

      await repository.save(agent);
      await this.replaceKnowledgeBaseLinks(manager, organizationId, id, knowledgeBaseIds);
      await this.replaceToolLinks(manager, organizationId, id, toolIds);
    });

    // Same reason as create(): read the full row back instead of trusting
    // save()'s partial return value.
    return this.findById(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    // Transactional like its siblings: reading the default-agent guard on one
    // pooled connection and deleting on another leaves a window where an
    // agent is promoted to default between the check and the delete.
    await this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(AiAgentEntity);

      const agent = await repository.findOne({
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!agent) {
        throw new NotFoundException({
          code: 'RESOURCE_NOT_FOUND',
          message: 'AI agent not found',
        });
      }

      if (agent.isDefault) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'Cannot delete the default AI agent — promote another agent first',
        });
      }

      await repository.remove(agent);
    });
  }

  /**
   * Demotes the incumbent default so the new one can take the flag.
   *
   * Takes the transaction's `EntityManager` rather than using the injected
   * repository. That distinction is the whole point: the repository draws a
   * *different* connection from the pool, so the write would block on the row
   * lock this very transaction holds, while the transaction waits for that
   * write to finish — a self-deadlock that hangs the request and then blocks
   * everything else touching `ai_agents`.
   *
   * The partial unique index makes the demotion necessary: without it, the
   * insert fails on a constraint violation instead of doing what the admin
   * meant.
   */
  private async demoteOtherDefaults(
    manager: EntityManager,
    organizationId: string,
    becomingDefault: boolean | undefined,
    excludeId?: string,
  ): Promise<void> {
    if (!becomingDefault) {
      return;
    }

    await manager.update(
      AiAgentEntity,
      {
        organizationId,
        isDefault: true,
        ...(excludeId ? { id: Not(excludeId) } : {}),
      },
      { isDefault: false },
    );
  }
}
