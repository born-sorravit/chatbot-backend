import { z } from 'zod';

/**
 * Environment contract. The app refuses to boot if this fails.
 *
 * Only Phase 1 variables are validated. Phase 3+ keys (LLM, embeddings,
 * storage) are listed in .env.example but deliberately not required yet —
 * demanding an LLM key to run migrations would be a lie about what the
 * app currently needs.
 */
const durationString = z
  .string()
  .regex(/^\d+[smhd]$/, 'must be a duration like 15m, 7d, 3600s');

export const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: z.stringbool().default(false),
  DATABASE_LOGGING: z.stringbool().default(false),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_QUEUE_PREFIX: z.string().default('chatbots'),

  // Auth — secrets must be long enough to be worth having
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: durationString.default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_TTL: durationString.default('7d'),
  CUSTOMER_SESSION_TTL: durationString.default('30d'),

  // LLM (chat). Phase 3.
  // `stub` is a real provider implementation, not a test double: it lets the
  // whole pipeline run without a key. Anthropic requires LLM_API_KEY, checked
  // at boot below rather than on the first customer message.
  LLM_PROVIDER: z.enum(['anthropic', 'stub']).default('stub'),
  LLM_API_KEY: z.string().optional(),
  LLM_DEFAULT_MODEL: z.string().default('claude-opus-5'),
  LLM_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  LLM_DEFAULT_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('low'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // Embeddings — a separate provider from the chat model (TD-06).
  // `lexical` is offline and needs no key; it matches shared character
  // sequences rather than meaning. See the provider's own docblock.
  EMBEDDING_PROVIDER: z.enum(['lexical', 'voyage']).default('lexical'),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('voyage-3.5'),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(128).default(64),

  // RAG. Leave RAG_MAX_DISTANCE unset to use the active provider's own
  // measured default — the right threshold differs per embedding model.
  RAG_TOP_K: z.coerce.number().int().positive().max(20).default(5),
  RAG_CANDIDATE_K: z.coerce.number().int().positive().max(100).default(20),
  RAG_MAX_DISTANCE: z.coerce.number().min(0).max(2).optional(),
  RAG_CHUNK_TOKENS: z.coerce.number().int().positive().default(800),
  RAG_CHUNK_OVERLAP: z.coerce.number().int().min(0).default(120),

  // AI behaviour
  AI_MAX_CONTEXT_MESSAGES: z.coerce.number().int().positive().max(100).default(20),
  AI_JOB_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  AI_JOB_BACKOFF_MS: z.coerce.number().int().positive().default(2000),

  // Observability / limits
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  // Provider webhooks share a handful of source IPs, so this is a floodgate
  // rather than a rate limit (ARCHITECTURE TD-48).
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(600),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Passed to ConfigModule.forRoot({ validate }). Throwing here stops boot,
 * which is the point: a missing secret should fail at startup, not on the
 * first request that needs it.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = result.data;

  if (env.LLM_PROVIDER === 'anthropic' && !env.LLM_API_KEY) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  - LLM_API_KEY is required when LLM_PROVIDER=anthropic ' +
        '(use LLM_PROVIDER=stub to run without one)',
    );
  }

  if (env.EMBEDDING_PROVIDER === 'voyage' && !env.EMBEDDING_API_KEY) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  - EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=voyage ' +
        '(use EMBEDDING_PROVIDER=lexical to run without one)',
    );
  }

  if (env.RAG_CHUNK_OVERLAP >= env.RAG_CHUNK_TOKENS) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  - RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_TOKENS, ' +
        'otherwise chunking cannot advance and would loop forever',
    );
  }

  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    throw new Error(
      'Invalid environment configuration:\n' +
        '  - JWT_REFRESH_SECRET must differ from JWT_SECRET (a leaked access ' +
        'secret would otherwise forge refresh tokens)',
    );
  }

  return env;
}
