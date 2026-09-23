import { Controller, Get, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRangeDto } from './dto';
import { CurrentOrg, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/constants';

@Controller('admin/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Operational metrics — volume, resolution, handoff, response time.
   *
   * Gated on `conversation.read`, so AGENTs see it: these are the numbers
   * about work they do themselves, and withholding them would make the
   * dashboard useless for the people staffing the inbox.
   */
  @Get('overview')
  @RequirePermissions(Permission.ConversationRead)
  overview(@CurrentOrg() organizationId: string, @Query() query: AnalyticsRangeDto) {
    return this.analytics.overview(organizationId, this.analytics.resolveRange(query));
  }

  /**
   * Token usage and spend.
   *
   * Gated on `settings.read` — deliberately stricter than the overview, which
   * confines cost to ADMIN/OWNER. AGENT has `conversation.read` but not
   * `settings.read`, so billing figures stay out of the inbox staff's view.
   */
  @Get('ai-usage')
  @RequirePermissions(Permission.SettingsRead)
  aiUsage(@CurrentOrg() organizationId: string, @Query() query: AnalyticsRangeDto) {
    return this.analytics.aiUsage(organizationId, this.analytics.resolveRange(query));
  }
}
