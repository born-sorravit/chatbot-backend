import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { CurrentOrg, CurrentUser, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/constants';
import type { AuthenticatedUser } from '../common/types';

export class ListNotificationsDto {
  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 30;
}

@Controller('admin/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Notifications are always the caller's own.
   *
   * There is deliberately no "list another user's notifications" — read state
   * is personal, and an endpoint that could target a userId would need a
   * permission model of its own for no benefit.
   */
  @Get()
  @RequirePermissions(Permission.ConversationRead)
  async list(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsDto,
  ) {
    const [data, unreadCount] = await Promise.all([
      this.notifications.list(
        organizationId,
        user.id,
        query.unreadOnly === 'true',
        query.limit,
      ),
      this.notifications.unreadCount(organizationId, user.id),
    ]);

    return { data, meta: { unreadCount } };
  }

  @Post(':id/read')
  @RequirePermissions(Permission.ConversationRead)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.notifications.markRead(organizationId, user.id, id);
  }

  @Post('read-all')
  @RequirePermissions(Permission.ConversationRead)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markAllRead(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.notifications.markAllRead(organizationId, user.id);
  }
}
