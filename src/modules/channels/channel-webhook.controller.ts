import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChannelIntegrationEntity } from '@/models/entities';
import { ChannelRegistry } from './channel-registry.service';
import { ChannelInboundService } from './channel-inbound.service';
import { Public, SkipTransform } from '@/shared/decorators';
import { WEBHOOK_MAX_BODY_BYTES } from '@/shared/constants';

/**
 * Provider webhooks.
 *
 * Public by necessity — LINE and Meta cannot present a JWT. The signature is
 * therefore the *only* authentication, which shapes everything here:
 *
 * - `organizationId` is read from the integration row **after** the signature
 *   verifies, never from the URL. The integration id in the path is
 *   attacker-supplied; treating it as proof of tenancy would be R-01.
 * - The body is taken as a raw Buffer via `@Req()`, not a DTO. The global
 *   `ValidationPipe` runs `forbidNonWhitelisted`, which would reject every
 *   real provider payload, and a signature computed over a re-serialised body
 *   does not match — key order and whitespace are part of the signed bytes.
 * - An unknown integration and a bad signature both answer 404, never 403.
 *   A 403 would confirm that an integration id exists, letting someone
 *   enumerate connected accounts.
 */
@Controller('webhooks')
export class ChannelWebhookController {
  private readonly logger = new Logger(ChannelWebhookController.name);

  constructor(
    @InjectRepository(ChannelIntegrationEntity)
    private readonly integrations: Repository<ChannelIntegrationEntity>,
    private readonly registry: ChannelRegistry,
    private readonly inbound: ChannelInboundService,
  ) {}

  /**
   * Meta's subscription handshake.
   *
   * Echoes `hub.challenge` only when `hub.verify_token` matches what the
   * admin configured — otherwise anyone who guessed the URL could confirm
   * the subscription.
   */
  @Get(':channel/:integrationId')
  @Public()
  @SkipTransform()
  async verifySubscription(
    @Param('channel') channel: string,
    @Param('integrationId', new ParseUUIDPipe()) integrationId: string,
    @Query() query: Record<string, string | undefined>,
  ): Promise<string> {
    const { integration, adapter } = await this.resolve(channel, integrationId);

    const challenge = adapter.handleVerification?.(query, integration.credentials) ?? null;

    if (challenge === null) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Not found' });
    }

    return challenge;
  }

  @Post(':channel/:integrationId')
  @Public()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Param('channel') channel: string,
    @Param('integrationId', new ParseUUIDPipe()) integrationId: string,
    @Req() request: RawBodyRequest<Request>,
  ): Promise<{ received: number; duplicates: number }> {
    const rawBody = request.rawBody;

    if (!rawBody || rawBody.length === 0) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Not found' });
    }

    // Checked before the HMAC runs: the endpoint is unauthenticated, so
    // without a cap anyone could make the server hash an arbitrarily large
    // buffer before the signature has a chance to reject it.
    if (rawBody.length > WEBHOOK_MAX_BODY_BYTES) {
      throw new ForbiddenException({ code: 'VALIDATION_ERROR', message: 'Payload too large' });
    }

    const { integration, adapter } = await this.resolve(channel, integrationId);

    const verified = adapter.verify({
      rawBody,
      headers: request.headers,
      credentials: integration.credentials,
    });

    if (!verified) {
      this.logger.warn({
        event: 'channel.signature_rejected',
        channel,
        integrationId,
      });
      // 404, not 401: a distinguishable response turns this into an oracle
      // for which integration ids exist.
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Not found' });
    }

    const parsed = adapter.parse(rawBody);

    // A correctly signed payload addressed to a *different* connected
    // account must not be accepted here. Without this, one tenant's valid
    // webhook could be replayed into another tenant's integration.
    if (
      integration.externalAccountId &&
      parsed.externalAccountId &&
      parsed.externalAccountId !== integration.externalAccountId
    ) {
      this.logger.warn({
        event: 'channel.account_mismatch',
        channel,
        integrationId,
      });
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Not found' });
    }

    let duplicates = 0;

    for (const message of parsed.messages) {
      const result = await this.inbound.handleMessage(integration, message);
      if (result.status === 'duplicate') duplicates += 1;
    }

    await this.integrations.update({ id: integration.id }, { lastInboundAt: new Date() });

    // Always 200, even for an empty or entirely duplicate batch. Providers
    // retry anything else, and a retry of a duplicate is a retry forever.
    return { received: parsed.messages.length, duplicates };
  }

  private async resolve(channel: string, integrationId: string) {
    if (!this.registry.has(channel)) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Not found' });
    }

    const integration = await this.integrations.findOne({
      where: { id: integrationId, channel, isActive: true },
    });

    if (!integration) {
      throw new NotFoundException({ code: 'RESOURCE_NOT_FOUND', message: 'Not found' });
    }

    return { integration, adapter: this.registry.get(integration.channel) };
  }
}
