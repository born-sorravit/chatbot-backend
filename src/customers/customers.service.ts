import { Injectable } from '@nestjs/common';
import { CustomersRepository } from './customers.repository';
import { CustomerEntity } from '../database/entities';
import type { CreateCustomerDto, ListCustomersDto, UpdateCustomerDto } from './dto';

export interface PaginatedCustomers {
  data: CustomerEntity[];
  meta: { total: number; page: number; limit: number; hasMore: boolean };
}

@Injectable()
export class CustomersService {
  constructor(private readonly customers: CustomersRepository) {}

  async list(organizationId: string, query: ListCustomersDto): Promise<PaginatedCustomers> {
    const skip = (query.page - 1) * query.limit;
    const [data, total] = await this.customers.search(
      organizationId,
      query.search,
      skip,
      query.limit,
    );

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        hasMore: skip + data.length < total,
      },
    };
  }

  /** Throws 404 for another organization's customer — never 403. */
  async findById(organizationId: string, id: string): Promise<CustomerEntity> {
    return this.customers.findByIdOrFail(organizationId, id);
  }

  async create(organizationId: string, dto: CreateCustomerDto): Promise<CustomerEntity> {
    return this.customers.create(organizationId, {
      name: dto.name ?? null,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      metadata: {},
      tags: [],
    });
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateCustomerDto,
  ): Promise<CustomerEntity> {
    return this.customers.updateById(organizationId, id, dto);
  }
}
