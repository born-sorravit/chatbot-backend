import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule, ConfigService } from '@nestjs/config';
import configuration, { type RateLimitConfig } from '@/config/configuration';
import { SharedModule } from '@/shared/shared.module';
import { ModelModule } from '@/models/model.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { UsersModule } from '@/modules/users/users.module';
import { OrganizationsModule } from '@/modules/organizations/organizations.module';
import { CustomersModule } from '@/modules/customers/customers.module';
import { ConversationsModule } from '@/modules/conversations/conversations.module';
import { MessagesModule } from '@/modules/messages/messages.module';
import { ChatModule } from '@/modules/chat/chat.module';
import { WebsocketModule } from '@/modules/websocket/websocket.module';
import { QueueModule } from '@/modules/queue/queue.module';
import { AiModule } from '@/modules/ai/ai.module';
import { AiAgentsModule } from '@/modules/ai-agents/ai-agents.module';
import { KnowledgeBaseModule } from '@/modules/knowledge-base/knowledge-base.module';
import { DocumentsModule } from '@/modules/documents/documents.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { ToolsModule } from '@/modules/tools/tools.module';
import { AnalyticsModule } from '@/modules/analytics/analytics.module';
import { ChannelsModule } from '@/modules/channels/channels.module';
import { AuditModule } from '@/modules/audit/audit.module';
import { WorkersModule } from '@/modules/workers/workers.module';
import { HealthModule } from '@/modules/health/health.module';
import { JwtAuthGuard, PermissionsGuard } from '@/shared/guards';
import { AllExceptionsFilter } from '@/shared/filters';
import { LoggingInterceptor, TransformInterceptor } from '@/shared/interceptors';
import { RequestIdMiddleware } from '@/shared/middleware';
import {
  isBruteForceSensitive,
  isHttpContext,
  isLlmSpending,
  isWebhookRoute,
} from '@/shared/throttling';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, load: [configuration] }),
    SharedModule,
    ModelModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const rateLimit = config.getOrThrow<RateLimitConfig>('rateLimit');

        return {
          throttlers: [
            // Every configured throttler is evaluated on every route, so the
            // strict auth limiter MUST opt out of non-auth routes — otherwise
            // it silently caps the entire API at the brute-force limit.
            {
              name: 'default',
              ttl: rateLimit.ttl * 1000,
              limit: rateLimit.max,
              skipIf: (context) =>
                !isHttpContext(context) ||
                isBruteForceSensitive(context) ||
                isLlmSpending(context) ||
                isWebhookRoute(context),
            },
            {
              name: 'auth',
              ttl: 60_000,
              limit: rateLimit.authMax,
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
              limit: rateLimit.webhookMax,
              skipIf: (context) => !isHttpContext(context) || !isWebhookRoute(context),
            },
          ],
        };
      },
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
