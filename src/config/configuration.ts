export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  /** api | worker | all — see docs/ARCHITECTURE.md §2.5 */
  role: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
}

export interface DatabaseConfig {
  url: string;
  ssl: boolean;
  logging: boolean;
}

export interface RedisConfig {
  url: string;
  queuePrefix: string;
}

export interface SecurityConfig {
  jwt: {
    secret: string;
    /** duration string, e.g. 15m */
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  customerSessionTtl: string;
}

export interface LlmConfig {
  /** anthropic | stub — stub runs the whole pipeline without a key */
  provider: string;
  apiKey: string;
  defaultModel: string;
  maxTokens: number;
  defaultEffort: string;
  timeoutMs: number;
}

export interface EmbeddingConfig {
  /** lexical | voyage — a separate provider from the chat model (TD-06) */
  provider: string;
  apiKey: string;
  model: string;
  batchSize: number;
}

export interface RagConfig {
  topK: number;
  candidateK: number;
  /** undefined = use the active embedding provider's measured default */
  maxDistance: number | undefined;
  chunkTokens: number;
  chunkOverlap: number;
}

export interface AiConfig {
  maxContextMessages: number;
  jobAttempts: number;
  jobBackoffMs: number;
}

export interface RateLimitConfig {
  /** seconds */
  ttl: number;
  max: number;
  authMax: number;
  /** provider webhooks share a few source IPs — a floodgate, not a rate limit */
  webhookMax: number;
}

export interface Configuration {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  security: SecurityConfig;
  llm: LlmConfig;
  embedding: EmbeddingConfig;
  rag: RagConfig;
  ai: AiConfig;
  rateLimit: RateLimitConfig;
  logLevel: string;
}

export default (): Configuration => ({
  app: {
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',
    role: process.env.APP_ROLE || 'all',
    port: parseInt(process.env.PORT || '4000', 10),
    apiPrefix: process.env.API_PREFIX || 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },
  database: {
    url: process.env.DATABASE_URL || '',
    ssl: process.env.DATABASE_SSL === 'true',
    logging: process.env.DATABASE_LOGGING === 'true',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    queuePrefix: process.env.REDIS_QUEUE_PREFIX || 'chatbots',
  },
  security: {
    jwt: {
      secret: process.env.JWT_SECRET || '',
      accessTtl: process.env.JWT_ACCESS_TTL || '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET || '',
      refreshTtl: process.env.JWT_REFRESH_TTL || '7d',
    },
    customerSessionTtl: process.env.CUSTOMER_SESSION_TTL || '30d',
  },
  llm: {
    provider: process.env.LLM_PROVIDER || 'stub',
    apiKey: process.env.LLM_API_KEY || '',
    defaultModel: process.env.LLM_DEFAULT_MODEL || 'claude-opus-5',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048', 10),
    defaultEffort: process.env.LLM_DEFAULT_EFFORT || 'low',
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '60000', 10),
  },
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER || 'lexical',
    apiKey: process.env.EMBEDDING_API_KEY || '',
    model: process.env.EMBEDDING_MODEL || 'voyage-3.5',
    batchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || '64', 10),
  },
  rag: {
    topK: parseInt(process.env.RAG_TOP_K || '5', 10),
    candidateK: parseInt(process.env.RAG_CANDIDATE_K || '20', 10),
    maxDistance: process.env.RAG_MAX_DISTANCE
      ? parseFloat(process.env.RAG_MAX_DISTANCE)
      : undefined,
    chunkTokens: parseInt(process.env.RAG_CHUNK_TOKENS || '800', 10),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || '120', 10),
  },
  ai: {
    maxContextMessages: parseInt(process.env.AI_MAX_CONTEXT_MESSAGES || '20', 10),
    jobAttempts: parseInt(process.env.AI_JOB_ATTEMPTS || '3', 10),
    jobBackoffMs: parseInt(process.env.AI_JOB_BACKOFF_MS || '2000', 10),
  },
  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
    max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    authMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
    webhookMax: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX || '600', 10),
  },
  logLevel: process.env.LOG_LEVEL || 'log',
});
