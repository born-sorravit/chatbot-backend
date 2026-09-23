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
  Query,
} from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import {
  CreateDocumentDto,
  ListDocumentsDto,
  SearchKnowledgeDto,
  UpsertKnowledgeBaseDto,
} from './dto';
import { RagService } from '@/modules/ai/rag/rag.service';
import { CurrentOrg, RequirePermissions } from '@/shared/decorators';
import { Permission } from '@/shared/constants';

@Controller('admin/knowledge-bases')
export class KnowledgeBaseController {
  constructor(
    private readonly service: KnowledgeBaseService,
    private readonly rag: RagService,
  ) {}

  @Get()
  @RequirePermissions(Permission.KnowledgeRead)
  list(@CurrentOrg() organizationId: string) {
    return this.service.list(organizationId);
  }

  @Get(':id')
  @RequirePermissions(Permission.KnowledgeRead)
  findOne(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findById(organizationId, id);
  }

  @Post()
  @RequirePermissions(Permission.KnowledgeWrite)
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentOrg() organizationId: string, @Body() dto: UpsertKnowledgeBaseDto) {
    return this.service.create(organizationId, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.KnowledgeWrite)
  update(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpsertKnowledgeBaseDto,
  ) {
    return this.service.update(organizationId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.KnowledgeWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(organizationId, id);
  }

  /* ── documents ───────────────────────────────────────────────────── */

  @Get(':id/documents')
  @RequirePermissions(Permission.KnowledgeRead)
  listDocuments(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListDocumentsDto,
  ) {
    return this.service.listDocuments(organizationId, id, query);
  }

  @Post(':id/documents')
  @RequirePermissions(Permission.KnowledgeWrite)
  @HttpCode(HttpStatus.CREATED)
  createDocument(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.service.createDocument(organizationId, id, dto);
  }

  /**
   * Retrieval debugger (docs/API.md §6).
   *
   * Runs the real search and returns distances *without* thresholding. When an
   * admin says "the AI doesn't know our refund policy", this answers whether
   * the chunk was retrieved and ranked, or never retrieved at all — which are
   * completely different problems.
   */
  @Get(':id/search')
  @RequirePermissions(Permission.KnowledgeRead)
  async search(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: SearchKnowledgeDto,
  ) {
    await this.service.requireKnowledgeBase(organizationId, id);

    const result = await this.rag.debugSearch(organizationId, [id], query.q, query.limit);

    return {
      maxDistance: result.maxDistance,
      chunks: result.chunks.map((chunk) => ({
        ...chunk,
        // Makes the threshold's effect visible rather than something the
        // admin has to compute mentally.
        relevant: chunk.distance <= result.maxDistance,
      })),
    };
  }
}
