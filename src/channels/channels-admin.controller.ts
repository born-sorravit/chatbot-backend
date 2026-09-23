import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ChannelsAdminService } from './channels-admin.service';
import { CreateChannelIntegrationDto, UpdateChannelIntegrationDto } from './dto';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/constants';

/**
 * Channel integration management.
 *
 * Reads need `settings.read`, writes need `settings.write` — connecting a
 * channel hands a third party a path into the inbox, which is an owner-level
 * act, not something an agent does.
 */
@Controller('admin/channels')
export class ChannelsAdminController {
  constructor(private readonly channels: ChannelsAdminService) {}

  @Get()
  @RequirePermissions(Permission.SettingsRead)
  list(@CurrentOrg() organizationId: string) {
    return this.channels.list(organizationId);
  }

  @Get(':id')
  @RequirePermissions(Permission.SettingsRead)
  findOne(@CurrentOrg() organizationId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.channels.findById(organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.SettingsWrite)
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateChannelIntegrationDto) {
    return this.channels.create(organizationId, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.SettingsWrite)
  update(
    @CurrentOrg() organizationId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateChannelIntegrationDto,
  ) {
    return this.channels.update(organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.SettingsWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentOrg() organizationId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.channels.remove(organizationId, id);
  }
}
