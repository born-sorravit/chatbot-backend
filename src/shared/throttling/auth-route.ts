import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Paths that get the strict brute-force limit rather than the general one.
 * Matched on the route suffix so the global API prefix does not matter.
 */
const BRUTE_FORCE_SENSITIVE = ['/auth/login', '/auth/refresh'];

/**
 * Routes that spend LLM tokens synchronously on each call.
 *
 * `POST /admin/ai-agents/:id/test` is admin-gated, but an admin holding Enter
 * would otherwise run 100 model calls a minute against the configured model.
 * The customer path is protected differently — it goes through the queue.
 */
const LLM_SPENDING = ['/ai-agents/:id/test'];

export function isLlmSpending(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') {
    return false;
  }

  const request = context.switchToHttp().getRequest<Request>();
  const path = (request.route?.path ?? request.path ?? '') as string;

  return LLM_SPENDING.some((suffix) => path.endsWith(suffix));
}

/**
 * Provider webhooks (Phase 8).
 *
 * These need their own budget. Every webhook for an organization arrives from
 * a small set of provider IPs, so under the general 100/min limit a busy LINE
 * account starts collecting 429s — the provider retries, and under sustained
 * load those are customer messages that are simply never accepted.
 *
 * Not exempted altogether: the endpoint is public and computes an HMAC before
 * it can reject anything, so it keeps a deliberately generous ceiling as a
 * floodgate rather than as a rate limit.
 */
export function isWebhookRoute(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') {
    return false;
  }

  const request = context.switchToHttp().getRequest<Request>();
  const path = (request.route?.path ?? request.path ?? '') as string;

  return path.includes('/webhooks/');
}

export function isBruteForceSensitive(context: ExecutionContext): boolean {
  if (context.getType() !== 'http') {
    return false;
  }

  const request = context.switchToHttp().getRequest<Request>();
  const path = (request.route?.path ?? request.path ?? '') as string;

  return BRUTE_FORCE_SENSITIVE.some((suffix) => path.endsWith(suffix));
}

/**
 * Throttling is HTTP-only.
 *
 * Global APP_GUARDs run in every execution context, and ThrottlerGuard
 * assumes an Express response — on a WebSocket event it throws
 * `res.header is not a function` and the event silently never completes.
 * WebSocket abuse is bounded separately: handshake auth plus the fact that
 * every socket action is server-verified against a room it had to be
 * admitted to.
 */
export function isHttpContext(context: ExecutionContext): boolean {
  return context.getType() === 'http';
}
