import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/constants';
import type { UserEntity } from '../database/entities';

/**
 * Admin user management.
 *
 * Requires user.read / user.write — permissions the AGENT role does not have,
 * so this is also where RBAC denial is observable end to end.
 */
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private toResponse(user: UserEntity) {
    // passwordHash has select:false so it is not loaded, but the projection
    // is explicit rather than relying on that — a future query that does
    // select it must not start leaking through this endpoint.
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      permissions: this.users.permissionsFor(user),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  @Get()
  @RequirePermissions(Permission.UserRead)
  async list(@CurrentOrg() organizationId: string) {
    const users = await this.users.list(organizationId);
    return users.map((user) => this.toResponse(user));
  }

  @Get(':id')
  @RequirePermissions(Permission.UserRead)
  async findOne(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.toResponse(await this.users.findById(organizationId, id));
  }

  @Post()
  @RequirePermissions(Permission.UserWrite)
  async create(@CurrentOrg() organizationId: string, @Body() dto: CreateUserDto) {
    const user = await this.users.create({ organizationId, ...dto });
    return this.toResponse(user);
  }
}
