import { Controller, Delete, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/constants';

/**
 * Document operations addressed by document id.
 *
 * Separate from the knowledge-base controller because these routes are not
 * nested under a knowledge base — §33 defines them as `/documents/:id`.
 */
@Controller('admin/documents')
export class DocumentsController {
  constructor(private readonly service: KnowledgeBaseService) {}

  @Post(':id/reindex')
  @RequirePermissions(Permission.KnowledgeWrite)
  @HttpCode(HttpStatus.OK)
  reindex(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.reindexDocument(organizationId, id);
  }

  @Delete(':id')
  @RequirePermissions(Permission.KnowledgeWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.removeDocument(organizationId, id);
  }
}
