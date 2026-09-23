import { AiAgentEntity } from '@/models/ai-agents/entities/ai-agent.entity';
import { AiAgentKnowledgeBaseEntity } from '@/models/ai-agents/entities/ai-agent-knowledge-base.entity';
import { AiAgentToolEntity } from '@/models/ai-agents/entities/ai-agent-tool.entity';
import { AiUsageLogEntity } from '@/models/ai-usage/entities/ai-usage-log.entity';
import { AuditLogEntity } from '@/models/audit-log/entities/audit-log.entity';
import { RefreshTokenEntity } from '@/models/auth/entities/refresh-token.entity';
import { OrderEntity } from '@/models/business/entities/order.entity';
import { ProductEntity } from '@/models/business/entities/product.entity';
import { ChannelIntegrationEntity } from '@/models/channels/entities/channel-integration.entity';
import { ConversationEntity } from '@/models/conversations/entities/conversation.entity';
import { CustomerEntity } from '@/models/customers/entities/customer.entity';
import { CustomerChannelIdentityEntity } from '@/models/customers/entities/customer-channel-identity.entity';
import { CustomerSessionEntity } from '@/models/customers/entities/customer-session.entity';
import { KnowledgeBaseEntity } from '@/models/knowledge-base/entities/knowledge-base.entity';
import { KnowledgeChunkEntity } from '@/models/knowledge-base/entities/knowledge-chunk.entity';
import { KnowledgeDocumentEntity } from '@/models/knowledge-base/entities/knowledge-document.entity';
import { MessageEntity } from '@/models/messages/entities/message.entity';
import { MessageAttachmentEntity } from '@/models/messages/entities/message-attachment.entity';
import { NotificationEntity } from '@/models/notifications/entities/notification.entity';
import { OrganizationEntity } from '@/models/organizations/entities/organization.entity';
import { AiToolEntity } from '@/models/tools/entities/ai-tool.entity';
import { ToolExecutionEntity } from '@/models/tools/entities/tool-execution.entity';
import { UserEntity } from '@/models/users/entities/user.entity';

export * from './base.entity';
export * from '@/models/organizations/entities/organization.entity';
export * from '@/models/users/entities/user.entity';
export * from '@/models/auth/entities/refresh-token.entity';
export * from '@/models/customers/entities/customer.entity';
export * from '@/models/customers/entities/customer-session.entity';
export * from '@/models/customers/entities/customer-channel-identity.entity';
export * from '@/models/conversations/entities/conversation.entity';
export * from '@/models/messages/entities/message.entity';
export * from '@/models/messages/entities/message-attachment.entity';
export * from '@/models/ai-agents/entities/ai-agent.entity';
export * from '@/models/ai-agents/entities/ai-agent-knowledge-base.entity';
export * from '@/models/ai-agents/entities/ai-agent-tool.entity';
export * from '@/models/ai-usage/entities/ai-usage-log.entity';
export * from '@/models/knowledge-base/entities/knowledge-base.entity';
export * from '@/models/knowledge-base/entities/knowledge-document.entity';
export * from '@/models/knowledge-base/entities/knowledge-chunk.entity';
export * from '@/models/notifications/entities/notification.entity';
export * from '@/models/tools/entities/ai-tool.entity';
export * from '@/models/tools/entities/tool-execution.entity';
export * from '@/models/business/entities/product.entity';
export * from '@/models/business/entities/order.entity';
export * from '@/models/audit-log/entities/audit-log.entity';
export * from '@/models/channels/entities/channel-integration.entity';

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
