import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { ulid } from 'ulid';
import type { MaybeAuthenticatedRequest } from '@/shared/interfaces/request-context';

/**
 * Stamps every request with a correlation id (docs/API.md §0).
 *
 * This is middleware, not an interceptor, and that distinction matters:
 * Nest runs middleware → guards → interceptors, so an interceptor would not
 * have run yet when a guard throws. Auth and permission failures are exactly
 * the responses an operator most needs to correlate, and as an interceptor
 * they were coming back with `requestId: "unknown"`.
 *
 * Honours an inbound x-request-id so a trace survives a proxy hop.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: MaybeAuthenticatedRequest, res: Response, next: NextFunction): void {
    const inbound = req.headers['x-request-id'];
    const requestId = typeof inbound === 'string' && inbound.length > 0 ? inbound : ulid();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    next();
  }
}
