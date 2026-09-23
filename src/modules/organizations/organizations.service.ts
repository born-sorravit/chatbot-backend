import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationEntity } from '@/models/entities';

@Injectable()
export class OrganizationsService {
  constructor(
    @InjectRepository(OrganizationEntity)
    private readonly organizations: Repository<OrganizationEntity>,
  ) {}

  /**
   * Organization is the tenant root, so it is not itself tenant-scoped —
   * it has no organizationId of its own. Access control happens by only
   * ever looking up the id carried on the verified principal.
   */
  async findById(id: string): Promise<OrganizationEntity> {
    const organization = await this.organizations.findOne({ where: { id } });

    if (!organization) {
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Organization not found',
      });
    }

    return organization;
  }

  async findBySlug(slug: string): Promise<OrganizationEntity | null> {
    return this.organizations.findOne({ where: { slug } });
  }

  async create(name: string, slug: string): Promise<OrganizationEntity> {
    return this.organizations.save(this.organizations.create({ name, slug, settings: {} }));
  }
}
