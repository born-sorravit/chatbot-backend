import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationEntity } from '../database/entities';
import { TenantScopedRepository } from '../common/repositories';
import { ConversationMode, ConversationStatus } from '../common/constants';

export interface ConversationFilters {
  status?: ConversationStatus;
  mode?: ConversationMode;
  assignedUserId?: string | 'unassigned';
  customerId?: string;
  search?: string;
}

@Injectable()
export class ConversationsRepository extends TenantScopedRepository<ConversationEntity> {
  constructor(@InjectRepository(ConversationEntity) repository: Repository<ConversationEntity>) {
    super(repository, 'Conversation');
  }

  /**
   * Admin inbox list (docs/API.md §3).
   *
   * organization_id leads the WHERE clause; every filter narrows within the
   * tenant and none can widen it. The customer join is needed for the name
   * shown in the list and for search.
   */
  async listForInbox(
    organizationId: string,
    filters: ConversationFilters,
    skip: number,
    take: number,
  ): Promise<[ConversationEntity[], number]> {
    const query = this.repository
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.customer', 'customer')
      .leftJoinAndSelect('conversation.assignedUser', 'assignedUser')
      .where('conversation.organization_id = :organizationId', { organizationId });

    if (filters.status) {
      query.andWhere('conversation.status = :status', { status: filters.status });
    }

    if (filters.mode) {
      query.andWhere('conversation.mode = :mode', { mode: filters.mode });
    }

    if (filters.assignedUserId === 'unassigned') {
      query.andWhere('conversation.assigned_user_id IS NULL');
    } else if (filters.assignedUserId) {
      query.andWhere('conversation.assigned_user_id = :assignedUserId', {
        assignedUserId: filters.assignedUserId,
      });
    }

    if (filters.customerId) {
      query.andWhere('conversation.customer_id = :customerId', {
        customerId: filters.customerId,
      });
    }

    if (filters.search) {
      query.andWhere(
        '(customer.name ILIKE :search OR customer.email ILIKE :search OR customer.phone ILIKE :search)',
        { search: `%${filters.search}%` },
      );
    }

    return query
      // NULLS LAST so a brand-new conversation with no messages yet does not
      // sort above active ones on some Postgres configurations.
      .orderBy('conversation.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('conversation.created_at', 'DESC')
      .skip(skip)
      .take(take)
      .getManyAndCount();
  }

  /**
   * The customer's current *open* conversation.
   *
   * Used by session start only: TD-09 says a returning visitor whose last
   * conversation is CLOSED gets a fresh one rather than reopening a resolved
   * thread.
   */
  async findActiveForCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<ConversationEntity | null> {
    return this.repository
      .createQueryBuilder('conversation')
      .where('conversation.organization_id = :organizationId', { organizationId })
      .andWhere('conversation.customer_id = :customerId', { customerId })
      .andWhere('conversation.status != :closed', { closed: ConversationStatus.Closed })
      .orderBy('conversation.created_at', 'DESC')
      .getOne();
  }

  /**
   * The customer's latest conversation, open or closed.
   *
   * Used by the live chat surface. An admin closing a conversation must not
   * break the widget the customer still has open — excluding CLOSED here made
   * `GET /chat/conversation` return 404 the moment an admin marked the thread
   * resolved, so the customer's window died rather than showing the closed
   * state with their history intact.
   *
   * Sending into a closed conversation reopens it (MessagesService.create),
   * so the customer can simply keep typing.
   */
  async findLatestForCustomer(
    organizationId: string,
    customerId: string,
  ): Promise<ConversationEntity | null> {
    return this.repository
      .createQueryBuilder('conversation')
      .where('conversation.organization_id = :organizationId', { organizationId })
      .andWhere('conversation.customer_id = :customerId', { customerId })
      .orderBy('conversation.created_at', 'DESC')
      .getOne();
  }
}
