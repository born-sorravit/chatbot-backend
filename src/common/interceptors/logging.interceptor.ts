import { CallHandler, ExecutionContext, Injectable, Logger, type NestInterceptor } from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { MaybeAuthenticatedRequest } from '../types/request-context';

/**
 * Structured access log (master plan §43).
 *
 * Logs identifiers and timings only. Never message content, customer
 * metadata, or credentials.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // HTTP only — a WS context has no method or url, so this would log a
    // row of undefined fields for every socket event.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.logger.log({
          requestId: request.requestId,
          organizationId: request.user?.organizationId,
          userId: request.user?.id,
          method: request.method,
          path: request.url,
          durationMs: Date.now() - startedAt,
        });
      }),
    );
  }
}
