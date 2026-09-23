import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { NotificationEntity, UserEntity } from '@/models/entities';
import { NotificationType, Permission, resolvePermissions } from '@/shared/constants';
import { RealtimeService } from '@/modules/websocket/realtime.service';

export interface NotifyInput {
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  conversationId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Notify only this user. Omitted means everyone in the organization who can
   * act on it.
   */
  userId?: string | null;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notifications: Repository<NotificationEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Creates notifications and pushes them live.
   *
   * Never throws. A notification is a courtesy on top of an action that has
   * already happened — failing to record one must not roll back a handoff or
   * fail a customer's message.
   */
  async notify(input: NotifyInput): Promise<void> {
    try {
      const recipients = input.userId
        ? [input.userId]
        : await this.recipientsFor(input.organizationId);

      if (recipients.length === 0) {
        this.logger.warn({
          event: 'notify.no_recipients',
          organizationId: input.organizationId,
          type: input.type,
        });
        return;
      }

      const rows = await this.notifications.save(
        recipients.map((userId) =>
          this.notifications.create({
            organizationId: input.organizationId,
            userId,
            type: input.type,
            title: input.title,
            message: input.message,
            conversationId: input.conversationId ?? null,
            metadata: input.metadata ?? {},
          }),
        ),
      );

      for (const row of rows) {
        this.realtime.emitNotification(row.userId, {
          id: row.id,
          type: row.type,
          title: row.title,
          message: row.message,
          conversationId: row.conversationId,
          createdAt: row.createdAt.toISOString(),
        });
      }

      this.logger.log({
        event: 'notify.sent',
        organizationId: input.organizationId,
        type: input.type,
        recipients: rows.length,
      });
    } catch (error) {
      this.logger.error({
        event: 'notify.failed',
        type: input.type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Active users who can actually reply to a conversation.
   *
   * Filtered by permission rather than notifying every user: telling someone
   * about work they cannot act on is noise, and noise is how people learn to
   * ignore the badge.
   */
  private async recipientsFor(organizationId: string): Promise<string[]> {
    const users = await this.users.find({
      where: { organizationId, isActive: true },
      select: { id: true, role: true, permissions: true },
    });

    return users
      .filter((user) =>
        resolvePermissions(user.role, user.permissions ?? []).includes(
          Permission.ConversationReply,
        ),
      )
      .map((user) => user.id);
  }

  async list(organizationId: string, userId: string, unreadOnly: boolean, limit: number) {
    return this.notifications.find({
      where: {
        organizationId,
        userId,
        ...(unreadOnly ? { readAt: IsNull() } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async unreadCount(organizationId: string, userId: string): Promise<number> {
    return this.notifications.count({
      where: { organizationId, userId, readAt: IsNull() },
    });
  }

  async markRead(organizationId: string, userId: string, id: string): Promise<void> {
    // Scoped by userId as well as organizationId: one admin must not be able
    // to dismiss another's notifications.
    await this.notifications.update(
      { id, organizationId, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }

  async markAllRead(organizationId: string, userId: string): Promise<void> {
    await this.notifications.update(
      { organizationId, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }
}
