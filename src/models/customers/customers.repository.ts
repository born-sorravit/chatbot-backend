import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerEntity } from '@/models/entities';
import { TenantScopedRepository } from '@/models/tenant-scoped.repository';

@Injectable()
export class CustomersRepository extends TenantScopedRepository<CustomerEntity> {
  constructor(@InjectRepository(CustomerEntity) repository: Repository<CustomerEntity>) {
    super(repository, 'Customer');
  }

  /**
   * Search across name / email / phone for the admin customer list.
   *
   * organization_id is in the WHERE clause, ahead of the search predicate —
   * the search never widens the tenant scope.
   */
  async search(
    organizationId: string,
    term: string | undefined,
    skip: number,
    take: number,
  ): Promise<[CustomerEntity[], number]> {
    const query = this.repository
      .createQueryBuilder('customer')
      .where('customer.organization_id = :organizationId', { organizationId });

    if (term) {
      query.andWhere(
        '(customer.name ILIKE :term OR customer.email ILIKE :term OR customer.phone ILIKE :term)',
        { term: `%${term}%` },
      );
    }

    return query.orderBy('customer.created_at', 'DESC').skip(skip).take(take).getManyAndCount();
  }
}
