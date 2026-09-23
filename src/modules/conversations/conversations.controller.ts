import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { AssignDto, CloseDto, ListConversationsDto, ReplyDto } from './dto';
import { ListMessagesDto } from '@/modules/chat/dto';
import { CurrentOrg, CurrentUser, RequirePermissions } from '@/shared/decorators';
import { Permission } from '@/shared/constants';
import type { AuthenticatedUser } from '@/shared/interfaces';

@Controller('admin/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @RequirePermissions(Permission.ConversationRead)
  async list(@CurrentOrg() organizationId: string, @Query() query: ListConversationsDto) {
    return this.conversations.list(organizationId, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ConversationRead)
  async detail(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.detail(organizationId, id);
  }

  @Get(':id/messages')
  @RequirePermissions(Permission.ConversationRead)
  async messages(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesDto,
  ) {
    return this.conversations.listMessages(organizationId, id, query.before, query.limit);
  }

  @Post(':id/messages')
  @RequirePermissions(Permission.ConversationReply)
  @HttpCode(HttpStatus.CREATED)
  async reply(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ReplyDto,
  ) {
    return this.conversations.reply(
      organizationId,
      id,
      { id: user.id, name: user.name },
      dto.content,
      dto.clientMessageId,
    );
  }

  /**
   * Take Over (master plan §30).
   *
   * Requires conversation.takeover — a permission AGENT holds, because
   * rescuing a stuck conversation is exactly their job.
   */
  @Post(':id/takeover')
  @RequirePermissions(Permission.ConversationTakeover)
  @HttpCode(HttpStatus.OK)
  takeOver(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversations.takeOver(organizationId, id, { id: user.id, name: user.name });
  }

  /** Return to AI (master plan §31). */
  @Post(':id/return-to-ai')
  @RequirePermissions(Permission.ConversationTakeover)
  @HttpCode(HttpStatus.OK)
  returnToAi(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversations.returnToAi(organizationId, id, { id: user.id, name: user.name });
  }

  @Post(':id/read')
  @RequirePermissions(Permission.ConversationRead)
  async markRead(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.markRead(organizationId, id);
  }

  @Post(':id/assign')
  @RequirePermissions(Permission.ConversationReply)
  async assign(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignDto,
  ) {
    return this.conversations.assign(organizationId, id, dto.userId ?? null);
  }

  @Post(':id/close')
  @RequirePermissions(Permission.ConversationClose)
  async close(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseDto,
  ) {
    return this.conversations.close(organizationId, id, dto.resolution);
  }

  @Post(':id/reopen')
  @RequirePermissions(Permission.ConversationClose)
  async reopen(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.conversations.reopen(organizationId, id);
  }
}
