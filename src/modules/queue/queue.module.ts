import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { QUEUE } from '@/shared/constants';
import { AiResponseQueue } from './ai-response.queue';
import { ChannelDeliveryQueue } from './channel-delivery.queue';

/**
 * BullMQ wiring (master plan §28).
 *
 * The queue is the boundary that keeps LLM latency out of the HTTP request
 * path (§4.1): a customer's POST returns as soon as the message is stored.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.getOrThrow<string>('redis.url'));

        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            // BullMQ requires this; a retry limit makes blocking commands
            // fail in ways the queue cannot recover from.
            maxRetriesPerRequest: null,
          },
          prefix: config.getOrThrow<string>('redis.queuePrefix'),
          defaultJobOptions: {
            attempts: config.getOrThrow<number>('ai.jobAttempts'),
            backoff: { type: 'exponential', delay: config.getOrThrow<number>('ai.jobBackoffMs') },
            // Failed jobs are retained for inspection; completed ones are
            // trimmed so Redis does not grow without bound.
            removeOnComplete: { count: 1000 },
            removeOnFail: false,
          },
        };
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE.AiResponse },
      { name: QUEUE.KnowledgeIngestion },
      { name: QUEUE.ChannelDelivery },
    ),
  ],
  // Producers live here rather than in each feature module: the queue is
  // global, and a module that forgot to provide one got a runtime resolution
  // error instead of a compile error. One home, one instance.
  providers: [AiResponseQueue, ChannelDeliveryQueue],
  exports: [BullModule, AiResponseQueue, ChannelDeliveryQueue],
})
export class QueueModule {}
