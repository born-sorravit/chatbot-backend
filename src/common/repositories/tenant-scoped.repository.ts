import { NotFoundException } from '@nestjs/common';
import type {
  DeepPartial,
  FindOptionsOrder,
  FindOptionsRelations,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';

export interface TenantScoped extends ObjectLiteral {
  id: string;
  organizationId: string;
}

export interface ScopedListOptions<T extends TenantScoped> {
  where?: FindOptionsWhere<T>;
  order?: FindOptionsOrder<T>;
  relations?: FindOptionsRelations<T>;
  skip?: number;
  take?: number;
}

/**
 * Layer 3 of the isolation strategy (docs/DATABASE.md §4).
 *
 * Every method takes `organizationId` as its first argument and merges it
 * into the WHERE clause. Because the argument is required and positional,
 * omitting the tenant filter is a compile error rather than a silent
 * full-table read — which is the entire point. Bypassing this class means
 * reaching for the raw repository, which is visible in review.
 *
 * A caller-supplied `where` cannot override the scope: organizationId is
 * spread last.
 */
export abstract class TenantScopedRepository<T extends TenantScoped> {
  protected constructor(
    protected readonly repository: Repository<T>,
    /** Used in the 404 message, e.g. 'Conversation'. */
    protected readonly entityName: string,
  ) {}

  protected scope(organizationId: string, where?: FindOptionsWhere<T>): FindOptionsWhere<T> {
    return { ...(where ?? {}), organizationId } as FindOptionsWhere<T>;
  }

  async findById(
    organizationId: string,
    id: string,
    relations?: FindOptionsRelations<T>,
  ): Promise<T | null> {
    return this.repository.findOne({
      where: this.scope(organizationId, { id } as FindOptionsWhere<T>),
      relations,
    });
  }

  /**
   * Throws 404 — never 403 — when the row belongs to another organization.
   * A 403 would confirm the resource exists, which is itself a leak
   * (docs/API.md §0).
   */
  async findByIdOrFail(
    organizationId: string,
    id: string,
    relations?: FindOptionsRelations<T>,
  ): Promise<T> {
    const entity = await this.findById(organizationId, id, relations);

    if (!entity) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: `${this.entityName} not found`,
      });
    }

    return entity;
  }

  async findOneBy(organizationId: string, where: FindOptionsWhere<T>): Promise<T | null> {
    return this.repository.findOne({ where: this.scope(organizationId, where) });
  }

  async findMany(organizationId: string, options: ScopedListOptions<T> = {}): Promise<T[]> {
    return this.repository.find({
      where: this.scope(organizationId, options.where),
      order: options.order,
      relations: options.relations,
      skip: options.skip,
      take: options.take,
    });
  }

  async findAndCount(
    organizationId: string,
    options: ScopedListOptions<T> = {},
  ): Promise<[T[], number]> {
    return this.repository.findAndCount({
      where: this.scope(organizationId, options.where),
      order: options.order,
      relations: options.relations,
      skip: options.skip,
      take: options.take,
    });
  }

  async count(organizationId: string, where?: FindOptionsWhere<T>): Promise<number> {
    return this.repository.count({ where: this.scope(organizationId, where) });
  }

  async exists(organizationId: string, where: FindOptionsWhere<T>): Promise<boolean> {
    return (await this.count(organizationId, where)) > 0;
  }

  /** Forces organizationId onto the row regardless of what the caller passed. */
  async create(organizationId: string, data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create({ ...data, organizationId } as DeepPartial<T>);
    return this.repository.save(entity);
  }

  async updateById(
    organizationId: string,
    id: string,
    patch: DeepPartial<T>,
  ): Promise<T> {
    const entity = await this.findByIdOrFail(organizationId, id);
    // organizationId is stripped so a patch can never move a row between
    // tenants, even if a DTO somehow carried the field.
    const { organizationId: _ignored, id: _id, ...safe } = patch as Record<string, unknown>;
    Object.assign(entity, safe);
    return this.repository.save(entity);
  }

  async deleteById(organizationId: string, id: string): Promise<void> {
    const entity = await this.findByIdOrFail(organizationId, id);
    await this.repository.remove(entity);
  }
}
