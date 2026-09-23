import type { ExecutionContext } from '@nestjs/common';
import { isBruteForceSensitive, isHttpContext, isLlmSpending, isWebhookRoute } from './auth-route';

/**
 * Which throttler applies to which route.
 *
 * Tested here rather than in e2e because `setup-e2e.ts` raises
 * `RATE_LIMIT_MAX` to 100000 — every request in the suite comes from one IP,
 * so real limits would fail the suite on request six. That makes the e2e
 * environment structurally unable to observe throttling, and a test there
 * would assert nothing while looking like coverage.
 */
function httpContext(path: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ route: { path }, path }) }),
  } as unknown as ExecutionContext;
}

function wsContext(): ExecutionContext {
  return { getType: () => 'ws' } as unknown as ExecutionContext;
}

describe('throttling route predicates', () => {
  describe('isWebhookRoute', () => {
    it('matches provider webhooks under the global prefix', () => {
      expect(isWebhookRoute(httpContext('/api/v1/webhooks/line/:integrationId'))).toBe(true);
      expect(isWebhookRoute(httpContext('/api/v1/webhooks/facebook/:integrationId'))).toBe(true);
      expect(isWebhookRoute(httpContext('/api/v1/webhooks/whatsapp/:integrationId'))).toBe(true);
    });

    it('does not match ordinary API routes', () => {
      // If this ever returns true, that route silently gets the 600/min
      // webhook budget instead of the general limit.
      expect(isWebhookRoute(httpContext('/api/v1/admin/channels'))).toBe(false);
      expect(isWebhookRoute(httpContext('/api/v1/chat/messages'))).toBe(false);
      expect(isWebhookRoute(httpContext('/api/v1/auth/login'))).toBe(false);
    });

    it('is false outside an HTTP context', () => {
      expect(isWebhookRoute(wsContext())).toBe(false);
    });
  });

  describe('throttler selection', () => {
    /** Mirrors the skipIf composition in app.module.ts. */
    const applies = {
      default: (c: ExecutionContext) =>
        isHttpContext(c) && !isBruteForceSensitive(c) && !isLlmSpending(c) && !isWebhookRoute(c),
      auth: (c: ExecutionContext) => isHttpContext(c) && isBruteForceSensitive(c),
      llm: (c: ExecutionContext) => isHttpContext(c) && isLlmSpending(c),
      webhook: (c: ExecutionContext) => isHttpContext(c) && isWebhookRoute(c),
    };

    /** Exactly one throttler must claim each route. */
    function claimants(path: string): string[] {
      const context = httpContext(path);
      return Object.entries(applies)
        .filter(([, predicate]) => predicate(context))
        .map(([name]) => name);
    }

    it('sends a webhook to the webhook throttler only', () => {
      // The whole point: under the general 100/min limit a busy LINE account
      // would start collecting 429s, and the provider's retries eventually
      // give up on messages we never accepted.
      expect(claimants('/api/v1/webhooks/line/:integrationId')).toEqual(['webhook']);
    });

    it('sends an ordinary route to the default throttler only', () => {
      expect(claimants('/api/v1/admin/conversations')).toEqual(['default']);
    });

    it('sends login to the auth throttler only', () => {
      expect(claimants('/api/v1/auth/login')).toEqual(['auth']);
    });

    it('sends the agent test endpoint to the llm throttler only', () => {
      expect(claimants('/api/v1/admin/ai-agents/:id/test')).toEqual(['llm']);
    });

    it('never leaves a route unthrottled', () => {
      for (const path of [
        '/api/v1/webhooks/whatsapp/:integrationId',
        '/api/v1/admin/channels',
        '/api/v1/auth/refresh',
        '/api/v1/chat/messages',
      ]) {
        expect(claimants(path).length).toBe(1);
      }
    });
  });
});
