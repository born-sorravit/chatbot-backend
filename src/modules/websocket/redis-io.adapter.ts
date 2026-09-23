import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger, type INestApplicationContext } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server, ServerOptions } from 'socket.io';
import Redis from 'ioredis';

/**
 * Fans socket events out across API instances.
 *
 * Needed for two reasons: the API process may be replicated, and from Phase 3
 * the AI worker is a separate process that holds no sockets at all — it
 * publishes to Redis and the adapter delivers to whichever instance actually
 * holds the client. Retrofitting this later would mean auditing every emit,
 * so it goes in now while there are only a handful.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    // The adapter needs its own pub and sub connections: a Redis client in
    // subscriber mode cannot issue ordinary commands, so the shared
    // application client cannot be reused here.
    const pubClient = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.ping(), subClient.ping()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.log.log('Socket.IO Redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    // Partial<ServerOptions>: IoAdapter's signature declares every field as
    // required, but socket.io itself fills in defaults for anything omitted.
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.corsOrigins, credentials: true },
    } as Partial<ServerOptions> as ServerOptions) as Server;

    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }

    return server;
  }
}
