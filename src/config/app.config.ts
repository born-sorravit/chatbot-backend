import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/**
 * Typed accessor over ConfigService.
 *
 * Every key is validated at boot, so `getOrThrow` can never actually throw
 * here — the non-null typing is earned, not asserted.
 */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get<K extends keyof Env>(key: K): Env[K] {
    return this.config.getOrThrow(key, { infer: true });
  }

  get nodeEnv() { return this.get('NODE_ENV'); }
  get isProduction() { return this.get('NODE_ENV') === 'production'; }
  get isTest() { return this.get('NODE_ENV') === 'test'; }
  get appRole() { return this.get('APP_ROLE'); }
  get port() { return this.get('PORT'); }
  get apiPrefix() { return this.get('API_PREFIX'); }

  get corsOrigins(): string[] {
    return this.get('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  get databaseUrl() { return this.get('DATABASE_URL'); }
  get databaseSsl() { return this.get('DATABASE_SSL'); }
  get databaseLogging() { return this.get('DATABASE_LOGGING'); }

  get redisUrl() { return this.get('REDIS_URL'); }
  get redisQueuePrefix() { return this.get('REDIS_QUEUE_PREFIX'); }

  get jwtSecret() { return this.get('JWT_SECRET'); }
  get jwtAccessTtl() { return this.get('JWT_ACCESS_TTL'); }
  get jwtRefreshSecret() { return this.get('JWT_REFRESH_SECRET'); }
  get jwtRefreshTtl() { return this.get('JWT_REFRESH_TTL'); }
  get customerSessionTtl() { return this.get('CUSTOMER_SESSION_TTL'); }

  get llmProvider() { return this.get('LLM_PROVIDER'); }
  get llmApiKey() { return this.config.get('LLM_API_KEY', { infer: true }); }
  get llmDefaultModel() { return this.get('LLM_DEFAULT_MODEL'); }
  get llmMaxTokens() { return this.get('LLM_MAX_TOKENS'); }
  get llmDefaultEffort() { return this.get('LLM_DEFAULT_EFFORT'); }
  get llmTimeoutMs() { return this.get('LLM_TIMEOUT_MS'); }

  get embeddingProvider() { return this.get('EMBEDDING_PROVIDER'); }
  get embeddingApiKey() { return this.config.get('EMBEDDING_API_KEY', { infer: true }); }
  get embeddingModel() { return this.get('EMBEDDING_MODEL'); }
  get embeddingBatchSize() { return this.get('EMBEDDING_BATCH_SIZE'); }

  get ragTopK() { return this.get('RAG_TOP_K'); }
  get ragCandidateK() { return this.get('RAG_CANDIDATE_K'); }
  /** Undefined means "use the active provider's measured default". */
  get ragMaxDistance() { return this.config.get('RAG_MAX_DISTANCE', { infer: true }); }
  get ragChunkTokens() { return this.get('RAG_CHUNK_TOKENS'); }
  get ragChunkOverlap() { return this.get('RAG_CHUNK_OVERLAP'); }

  get aiMaxContextMessages() { return this.get('AI_MAX_CONTEXT_MESSAGES'); }
  get aiJobAttempts() { return this.get('AI_JOB_ATTEMPTS'); }
  get aiJobBackoffMs() { return this.get('AI_JOB_BACKOFF_MS'); }

  get logLevel() { return this.get('LOG_LEVEL'); }
  get rateLimitTtl() { return this.get('RATE_LIMIT_TTL'); }
  get rateLimitMax() { return this.get('RATE_LIMIT_MAX'); }
  get authRateLimitMax() { return this.get('AUTH_RATE_LIMIT_MAX'); }
  get webhookRateLimitMax() { return this.get('WEBHOOK_RATE_LIMIT_MAX'); }
}
