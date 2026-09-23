import { SetMetadata } from '@nestjs/common';
import type { PermissionValue } from '@/shared/constants/permissions';

export const PERMISSIONS_KEY = 'required_permissions';

/** Route requires ALL listed permissions. Enforced by PermissionsGuard. */
export const RequirePermissions = (...permissions: PermissionValue[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
