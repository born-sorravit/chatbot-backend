import { CanActivate, Injectable, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { CustomerSessionService } from '../../chat/customer-session.service';
import type { CustomerRequest } from '../types';

export const CUSTOMER_SESSION_COOKIE = 'chatbots_cs';

/**
 * Reads the anonymous customer session token.
 *
 * Cookie first (httpOnly, set by POST /chat/sessions), falling back to a
 * bearer header so the widget can also run where third-party cookies are
 * blocked.
 */
export function readSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CUSTOMER_SESSION_COOKIE && rest.length > 0) {
      return decodeURIComponent(rest.join('='));
    }
  }

  return undefined;
}

export function extractCustomerToken(request: Request): string | undefined {
  return (
    readSessionCookie(request.headers.cookie) ??
    (request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice(7)
      : undefined)
  );
}

/**
 * Guards the customer chat surface (docs/API.md §0).
 *
 * Separate from JwtAuthGuard because the two audiences hold different
 * credentials and must see different data. Routes using this guard are marked
 * @Public() so the global JWT guard steps aside.
 */
@Injectable()
export class CustomerSessionGuard implements CanActivate {
  constructor(private readonly sessions: CustomerSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();

    request.customer = await this.sessions.resolve(extractCustomerToken(request));

    // Fire and forget: a failed liveness update must not fail the request.
    void this.sessions.touch(request.customer.sessionId).catch(() => undefined);

    return true;
  }
}
