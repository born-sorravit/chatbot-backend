import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'is_public';

/**
 * Opts a route out of the global JwtAuthGuard.
 *
 * Auth is deny-by-default: the guard is registered globally, so a new
 * controller is protected unless it explicitly says otherwise. Forgetting
 * a decorator locks people out; it cannot expose data.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
