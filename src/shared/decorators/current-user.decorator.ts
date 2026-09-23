import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from '@/shared/interfaces/request-context';

/** Injects the verified principal. Requires JwtAuthGuard on the route. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return data ? request.user?.[data] : request.user;
  },
);

/**
 * Injects the organization id of the verified principal.
 *
 * Exists as its own decorator to make the tenant boundary visible at every
 * call site: a handler that takes `@CurrentOrg()` is obviously scoped.
 */
export const CurrentOrg = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user?.organizationId;
});
