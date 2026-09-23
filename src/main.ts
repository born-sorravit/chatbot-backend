import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '@/config/configuration';
import { RedisIoAdapter } from '@/modules/websocket/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // rawBody keeps the untouched request bytes on `req.rawBody`, which the
  // channel webhooks need: provider signatures are computed over the exact
  // payload, and re-serialising the parsed body changes key order and
  // whitespace, so the HMAC would never match (docs/ARCHITECTURE.md TD-47).
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService);
  const appConfig = config.getOrThrow<AppConfig>('app');
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix(appConfig.apiPrefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Unknown fields are rejected outright rather than stripped, so a
      // typo'd field name fails loudly instead of silently doing nothing
      // (master plan §49.3).
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  const redisAdapter = new RedisIoAdapter(
    app,
    config.getOrThrow<string>('redis.url'),
    appConfig.corsOrigins,
  );
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  app.enableShutdownHooks();

  if (appConfig.role === 'worker') {
    // Phase 3 will start BullMQ processors here without an HTTP listener.
    logger.log('APP_ROLE=worker — HTTP server not started');
    await app.init();
    return;
  }

  await app.listen(appConfig.port);
  logger.log(`API listening on http://localhost:${appConfig.port}/${appConfig.apiPrefix}`);
  logger.log(`Role: ${appConfig.role} · env: ${appConfig.nodeEnv}`);
}

void bootstrap();
