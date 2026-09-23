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
import { AiAgentsService } from './ai-agents.service';
import { CreateAiAgentDto, TestAiAgentDto, UpdateAiAgentDto } from './dto';
import { AiAgentTester } from './ai-agent-tester.service';
import { CurrentOrg, RequirePermissions } from '@/shared/decorators';
import { Permission } from '@/shared/constants';

@Controller('admin/ai-agents')
export class AiAgentsController {
  constructor(
    private readonly agents: AiAgentsService,
    private readonly tester: AiAgentTester,
  ) {}

  @Get()
  @RequirePermissions(Permission.AiRead)
  list(@CurrentOrg() organizationId: string) {
    return this.agents.list(organizationId);
  }

  @Get(':id')
  @RequirePermissions(Permission.AiRead)
  findOne(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.agents.findById(organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.AiWrite)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateAiAgentDto) {
    return this.agents.create(organizationId, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AiWrite)
  update(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAiAgentDto,
  ) {
    return this.agents.update(organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.AiWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.agents.remove(organizationId, id);
  }

  /**
   * Dry run against a throwaway conversation (docs/API.md §5).
   *
   * Lets an admin check a prompt change before customers meet it.
   */
  @Post(':id/test')
  @RequirePermissions(Permission.AiWrite)
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TestAiAgentDto,
  ) {
    return this.tester.run(organizationId, id, dto.message);
  }
}
