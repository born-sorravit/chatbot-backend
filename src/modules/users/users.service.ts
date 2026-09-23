import { ConflictException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UsersRepository } from '@/models/users/users.repository';
import { UserEntity } from '@/models/entities';
import { resolvePermissions, UserRole, type PermissionValue } from '@/shared/constants';

export interface CreateUserInput {
  organizationId: string;
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  permissions?: string[];
}

/**
 * argon2id parameters. Defaults are already sensible; these are pinned so a
 * library default change can't silently weaken stored hashes.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — OWASP minimum recommendation
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class UsersService {
  constructor(private readonly users: UsersRepository) {}

  async hashPassword(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  async verifyPassword(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      // A malformed hash in the database must read as "wrong password",
      // never as a 500 that tells an attacker the account is special.
      return false;
    }
  }

  async create(input: CreateUserInput): Promise<UserEntity> {
    const existing = await this.users.findOneBy(input.organizationId, { email: input.email });

    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'A user with this email already exists in this organization',
      });
    }

    return this.users.create(input.organizationId, {
      email: input.email,
      name: input.name,
      passwordHash: await this.hashPassword(input.password),
      role: input.role ?? UserRole.Agent,
      permissions: input.permissions ?? [],
      isActive: true,
    });
  }

  permissionsFor(user: Pick<UserEntity, 'role' | 'permissions'>): PermissionValue[] {
    return resolvePermissions(user.role, user.permissions ?? []);
  }

  async findById(organizationId: string, id: string): Promise<UserEntity> {
    return this.users.findByIdOrFail(organizationId, id);
  }

  async list(organizationId: string): Promise<UserEntity[]> {
    return this.users.findMany(organizationId, { order: { createdAt: 'DESC' } });
  }
}
