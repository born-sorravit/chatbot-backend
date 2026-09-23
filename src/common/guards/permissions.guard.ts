import {
  CanActivate,
  ForbiddenException,
  Injectable,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { PermissionValue } from '../constants/permissions';
import type { AuthenticatedRequest } from '../types/request-context';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // HTTP only — @RequirePermissions is a route decorator, and a WS context
    // has no request to read the principal from.
    if (context.getType() !== 'http') {
      return true;
    }

    const required = this.reflector.getAllAndOverride<PermissionValue[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = new Set(request.user?.permissions ?? []);

    const missing = required.filter((permission) => !granted.has(permission));

    if (missing.length > 0) {
      // Names the missing permission, not the resource — this tells an
      // operator why the call failed without confirming anything about
      // what the caller was reaching for.
      throw new ForbiddenException({
        code: 'INSUFFICIENT_PERMISSIONS',
        message: `Missing required permission(s): ${missing.join(', ')}`,
      });
    }

    return true;
  }
}
