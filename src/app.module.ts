import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfig, AppConfigModule } from './config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { CustomersModule } from './customers/customers.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { ChatModule } from './chat/chat.module';
import { WebsocketModule } from './websocket/websocket.module';
import { QueueModule } from './queue/queue.module';
import { AiModule } from './ai/ai.module';
import { AiAgentsModule } from './ai-agents/ai-agents.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { DocumentsModule } from './documents/documents.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ToolsModule } from './tools/tools.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ChannelsModule } from './channels/channels.module';
import { AuditModule } from './audit/audit.module';
import { WorkersModule } from './workers/workers.module';
import { HealthModule } from './health/health.module';
import { JwtAuthGuard, PermissionsGuard } from './common/guards';
import { AllExceptionsFilter } from './common/filters';
import { LoggingInterceptor, TransformInterceptor } from './common/interceptors';
import { RequestIdMiddleware } from './common/middleware';
import {
  isBruteForceSensitive,
  isHttpContext,
  isLlmSpending,
  isWebhookRoute,
} from './common/throttling';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [
          // Every configured throttler is evaluated on every route, so the
          // strict auth limiter MUST opt out of non-auth routes — otherwise
          // it silently caps the entire API at the brute-force limit.
          {
            name: 'default',
            ttl: config.rateLimitTtl * 1000,
            limit: config.rateLimitMax,
            skipIf: (context) =>
              !isHttpContext(context) ||
              isBruteForceSensitive(context) ||
              isLlmSpending(context) ||
              isWebhookRoute(context),
          },
          {
            name: 'auth',
            ttl: 60_000,
            limit: config.authRateLimitMax,
            skipIf: (context) => !isHttpContext(context) || !isBruteForceSensitive(context),
          },
          {
            // Token-spending admin routes, deliberately far stricter than the
            // general limit.
            name: 'llm',
            ttl: 60_000,
            limit: 10,
            skipIf: (context) => !isHttpContext(context) || !isLlmSpending(context),
          },
          {
            // Provider webhooks. Far more generous than the general limit
            // because all of an organization's traffic arrives from a few
            // provider IPs — see isWebhookRoute for why this is a floodgate
            // and not a rate limit.
            name: 'webhook',
            ttl: 60_000,
            limit: config.webhookRateLimitMax,
            skipIf: (context) => !isHttpContext(context) || !isWebhookRoute(context),
          },
        ],
      }),
    }),
    OrganizationsModule,
    UsersModule,
    AuthModule,
    CustomersModule,
    QueueModule,
    MessagesModule,
    ConversationsModule,
    ChatModule,
    WebsocketModule,
    AiModule,
    AiAgentsModule,
    AuditModule,
    NotificationsModule,
    ToolsModule,
    AnalyticsModule,
    ChannelsModule,
    EmbeddingsModule,
    DocumentsModule,
    KnowledgeBaseModule,
    // Processors are registered unless this process is api-only, so a
    // horizontally scaled API does not also consume the queue.
    ...(process.env.APP_ROLE === 'api' ? [] : [WorkersModule]),
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Deny by default: every route needs a valid JWT unless marked @Public().
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Middleware runs before guards, so auth/permission failures carry a
    // requestId too. An interceptor would be too late for those.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
