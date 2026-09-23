import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelIntegrationEntity, type ChannelCredentials } from '../database/entities';
import { ChannelRegistry } from './channel-registry.service';
import { ChannelType } from '../common/constants';
import type { CreateChannelIntegrationDto, UpdateChannelIntegrationDto } from './dto';

export interface ChannelIntegrationView {
  id: string;
  channel: ChannelType;
  displayName: string;
  externalAccountId: string | null;
  isActive: boolean;
  /** Which required keys are set — never the values. */
  credentialStatus: Record<string, boolean>;
  webhookPath: string;
  lastInboundAt: string | null;
  lastError: string | null;
  createdAt: string;
}

@Injectable()
export class ChannelsAdminService {
  constructor(
    @InjectRepository(ChannelIntegrationEntity)
    private readonly integrations: Repository<ChannelIntegrationEntity>,
    private readonly registry: ChannelRegistry,
  ) {}

  async list(organizationId: string): Promise<ChannelIntegrationView[]> {
    const rows = await this.integrations.find({
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => this.toView(row));
  }

  async findById(organizationId: string, id: string): Promise<ChannelIntegrationView> {
    return this.toView(await this.require(organizationId, id));
  }

  async create(
    organizationId: string,
    dto: CreateChannelIntegrationDto,
  ): Promise<ChannelIntegrationView> {
    if (dto.channel === ChannelType.Web) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'The web widget is built in and cannot be connected as an integration',
      });
    }

    this.assertCredentials(dto.channel, dto.credentials);

    const existing = await this.integrations.findOne({
      where: { organizationId, channel: dto.channel },
    });

    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `${dto.channel} is already connected — edit the existing integration instead`,
      });
    }

    const saved = await this.integrations.save(
      this.integrations.create({
        organizationId,
        channel: dto.channel,
        displayName: dto.displayName,
        externalAccountId: dto.externalAccountId ?? null,
        credentials: dto.credentials,
        isActive: dto.isActive ?? true,
      }),
    );

    return this.toView(saved);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateChannelIntegrationDto,
  ): Promise<ChannelIntegrationView> {
    const integration = await this.require(organizationId, id);

    if (dto.displayName !== undefined) integration.displayName = dto.displayName;
    if (dto.externalAccountId !== undefined) {
      integration.externalAccountId = dto.externalAccountId || null;
    }
    if (dto.isActive !== undefined) integration.isActive = dto.isActive;

    if (dto.credentials) {
      // Merged, not replaced: the admin UI never receives the existing
      // secrets back, so a full replace would wipe every key the form did
      // not re-enter — silently breaking a channel on a rename.
      const merged = { ...integration.credentials, ...dto.credentials };

      // An empty string means "clear this key", which is how a credential
      // gets removed without a separate endpoint.
      for (const [key, value] of Object.entries(dto.credentials)) {
        if (value === '') delete merged[key];
      }

      this.assertCredentials(integration.channel, merged);
      integration.credentials = merged;
    }

    return this.toView(await this.integrations.save(integration));
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const integration = await this.require(organizationId, id);
    await this.integrations.remove(integration);
  }

  private async require(organizationId: string, id: string): Promise<ChannelIntegrationEntity> {
    const integration = await this.integrations.findOne({ where: { id, organizationId } });

    if (!integration) {
      // 404 rather than 403 for a row in another organization (TD-04).
      throw new NotFoundException({
        code: 'RESOURCE_NOT_FOUND',
        message: 'Channel integration not found',
      });
    }

    return integration;
  }

  private assertCredentials(channel: ChannelType, credentials: ChannelCredentials): void {
    const missing = this.registry
      .requiredCredentials(channel)
      .filter((key) => !credentials[key]?.trim());

    if (missing.length > 0) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Missing credentials for ${channel}: ${missing.join(', ')}`,
      });
    }
  }

  /**
   * Admin projection.
   *
   * Credentials are reported as a set of booleans, never as values — not even
   * masked ones. A masked secret still leaks its length, and an admin console
   * is exactly where a screen-share leaks it.
   */
  private toView(row: ChannelIntegrationEntity): ChannelIntegrationView {
    const required = this.registry.requiredCredentials(row.channel);

    return {
      id: row.id,
      channel: row.channel,
      displayName: row.displayName,
      externalAccountId: row.externalAccountId,
      isActive: row.isActive,
      credentialStatus: Object.fromEntries(
        required.map((key) => [key, Boolean(row.credentials[key])]),
      ),
      // The URL to paste into the provider console. Relative — the public
      // origin depends on the deployment, and guessing it here would put a
      // wrong URL in front of the admin.
      webhookPath: `/webhooks/${row.channel}/${row.id}`,
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
