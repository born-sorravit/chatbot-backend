import { CallHandler, ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { SKIP_TRANSFORM_KEY } from '@/shared/decorators/skip-transform.decorator';

/**
 * Wraps handler output in the { data } envelope (docs/API.md §0).
 *
 * A handler that already returns { data, meta } — paginated lists — is passed
 * through untouched so it can carry its own meta block.
 *
 * HTTP only. Global interceptors run in every execution context, and
 * wrapping a WebSocket handler's return value corrupts the ack the client
 * receives: `{ ok: true }` arrives as `{ data: { ok: true } }`, which reads
 * as a silent failure on the client rather than an error anywhere.
 *
 * `@SkipTransform()` opts a route out entirely — required where a third
 * party dictates the response body, such as Meta's webhook handshake.
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skip) {
      return next.handle();
    }

    return next.handle().pipe(
      map((payload) => {
        if (payload === undefined || payload === null) {
          return payload;
        }
        if (typeof payload === 'object' && payload !== null && 'data' in payload) {
          return payload;
        }
        return { data: payload };
      }),
    );
  }
}
