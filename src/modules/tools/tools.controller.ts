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
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ToolsAdminService } from './tools-admin.service';
import { CurrentOrg, CurrentUser, RequirePermissions } from '@/shared/decorators';
import { Permission, ToolExecutionStatus } from '@/shared/constants';
import type { AuthenticatedUser } from '@/shared/interfaces';

export class ListExecutionsDto {
  @IsOptional()
  @IsEnum(ToolExecutionStatus)
  status?: ToolExecutionStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

export class RejectExecutionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

@Controller('admin/tools')
export class ToolsController {
  constructor(private readonly tools: ToolsAdminService) {}

  /** Tools available to this organization, with their schemas. */
  @Get()
  @RequirePermissions(Permission.AiRead)
  list(@CurrentOrg() organizationId: string) {
    return this.tools.list(organizationId);
  }
}

@Controller('admin/tool-executions')
export class ToolExecutionsController {
  constructor(private readonly tools: ToolsAdminService) {}

  /**
   * The execution log (master plan §25).
   *
   * Includes rejections and validation failures, not just successes — "the AI
   * tried to call something it was not allowed to" is the entry worth finding.
   */
  @Get()
  @RequirePermissions(Permission.AiRead)
  listExecutions(@CurrentOrg() organizationId: string, @Query() query: ListExecutionsDto) {
    return this.tools.listExecutions(organizationId, query);
  }

  /**
   * Approve a pending mutating call (§25).
   *
   * Requires ai.write, not merely conversation.reply: approving a data change
   * is a different weight of decision from answering a customer.
   */
  @Post(':id/approve')
  @RequirePermissions(Permission.AiWrite)
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tools.approve(organizationId, id, user.id);
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.AiWrite)
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RejectExecutionDto,
  ) {
    return this.tools.reject(organizationId, id, user.id, dto.reason);
  }
}
