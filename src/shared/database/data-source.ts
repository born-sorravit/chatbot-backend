import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';
import configuration from '@/config/configuration';
import { ENTITIES } from '@/models/entities';

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
  const database = configuration().database;

  return {
    type: 'postgres',
    url: database.url,
    ssl: database.ssl ? { rejectUnauthorized: false } : false,
    logging: database.logging,
    synchronize: false,
    entities: ENTITIES,
    migrations: [isCompiled ? `${__dirname}/migrations/*.js` : `${__dirname}/migrations/*.ts`],
    migrationsTableName: 'typeorm_migrations',
  };
}

/** CLI entry point — `npm run migration:run` resolves this default export. */
export default new DataSource(buildDataSourceOptions());
