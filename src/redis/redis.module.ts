import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../config';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfig],
      useFactory: (config: AppConfig): Redis => {
        const logger = new Logger('Redis');
        const client = new Redis(config.redisUrl, {
          // BullMQ requires this in Phase 3; setting it now keeps one shared
          // connection configuration rather than two divergent ones.
          maxRetriesPerRequest: null,
          lazyConnect: false,
        });

        client.on('error', (error: Error) => logger.error(`Redis error: ${error.message}`));
        client.on('connect', () => logger.log('Redis connected'));

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  /**
   * Nest does not tear down connections held by useFactory providers, so the
   * socket must be closed explicitly. Without this the process keeps running
   * after app.close() — which is how it first showed up: Jest reporting
   * "did not exit one second after the test run completed".
   */
  async onApplicationShutdown(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }

    try {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    } catch {
      // quit() rejects if the socket already dropped; force it shut rather
      // than leaving a half-open handle behind.
      this.client.disconnect();
    }
  }
}
