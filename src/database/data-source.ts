import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  AiAgentEntity,
  AiAgentKnowledgeBaseEntity,
  AiAgentToolEntity,
  AiToolEntity,
  AuditLogEntity,
  ChannelIntegrationEntity,
  CustomerChannelIdentityEntity,
  OrderEntity,
  ProductEntity,
  ToolExecutionEntity,
  AiUsageLogEntity,
  ConversationEntity,
  CustomerEntity,
  CustomerSessionEntity,
  MessageAttachmentEntity,
  MessageEntity,
  OrganizationEntity,
  KnowledgeBaseEntity,
  KnowledgeChunkEntity,
  KnowledgeDocumentEntity,
  NotificationEntity,
  RefreshTokenEntity,
  UserEntity,
} from './entities';

/**
 * Concrete entities only — BaseEntity and TenantEntity are abstract bases and
 * must never be registered. Listed explicitly rather than globbed so that
 * adding an entity is a deliberate, reviewable act.
 */
export const ENTITIES = [
  OrganizationEntity,
  UserEntity,
  RefreshTokenEntity,
  CustomerEntity,
  CustomerSessionEntity,
  CustomerChannelIdentityEntity,
  ConversationEntity,
  MessageEntity,
  MessageAttachmentEntity,
  AiAgentEntity,
  AiUsageLogEntity,
  KnowledgeBaseEntity,
  KnowledgeDocumentEntity,
  KnowledgeChunkEntity,
  AiAgentKnowledgeBaseEntity,
  NotificationEntity,
  AiToolEntity,
  AiAgentToolEntity,
  ToolExecutionEntity,
  ProductEntity,
  OrderEntity,
  AuditLogEntity,
  ChannelIntegrationEntity,
];

loadEnv();

const isCompiled = __filename.endsWith('.js');

/**
 * Shared TypeORM configuration.
 *
 * `synchronize` is false in every environment including test. Schema changes
 * go through reviewed migration files — a schema that drifts by side effect
 * cannot be reviewed, and the pgvector column and partial indexes added in
 * Phase 4 are not things synchronize reproduces reliably
 * (docs/DATABASE.md §5).
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DATABASE_URL is required to build the TypeORM data source');
  }

  return {
    type: 'postgres',
    url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    logging: process.env.DATABASE_LOGGING === 'true',
    synchronize: false,
    entities: ENTITIES,
    migrations: [
      isCompiled ? `${__dirname}/migrations/*.js` : `${__dirname}/migrations/*.ts`,
    ],
    migrationsTableName: 'typeorm_migrations',
  };
}

/** CLI entry point — `npm run migration:run` resolves this default export. */
export default new DataSource(buildDataSourceOptions());
