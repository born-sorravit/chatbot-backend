import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { ListCustomersDto, UpdateCustomerDto } from './dto';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/constants';

@Controller('admin/customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions(Permission.ConversationRead)
  async list(@CurrentOrg() organizationId: string, @Query() query: ListCustomersDto) {
    return this.customers.list(organizationId, query);
  }

  @Get(':id')
  @RequirePermissions(Permission.ConversationRead)
  async findOne(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.customers.findById(organizationId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ConversationReply)
  async update(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(organizationId, id, dto);
  }
}
