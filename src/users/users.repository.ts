import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../database/entities';
import { TenantScopedRepository } from '../common/repositories';

@Injectable()
export class UsersRepository extends TenantScopedRepository<UserEntity> {
  constructor(@InjectRepository(UserEntity) repository: Repository<UserEntity>) {
    super(repository, 'User');
  }

  /**
   * Login lookup. Deliberately NOT tenant-scoped: at login time there is no
   * authenticated organization yet — the organization is derived FROM the
   * user record, not used to find it.
   *
   * `passwordHash` has `select: false` on the entity, so it must be requested
   * explicitly here.
   */
  async findForLogin(email: string, organizationSlug?: string): Promise<UserEntity | null> {
    const query = this.repository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .innerJoinAndSelect('user.organization', 'organization')
      .where('user.email = :email', { email });

    if (organizationSlug) {
      query.andWhere('organization.slug = :organizationSlug', { organizationSlug });
    }

    return query.getOne();
  }

  async findActiveById(id: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id, isActive: true } });
  }

  async markLoggedIn(id: string): Promise<void> {
    await this.repository.update({ id }, { lastLoginAt: new Date() });
  }
}
