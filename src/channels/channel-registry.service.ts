import { BadRequestException, Injectable } from '@nestjs/common';
import { ChannelType } from '../common/constants';
import type { ChannelAdapter } from './channel-adapter.interface';
import { LineAdapter } from './adapters/line.adapter';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { WhatsappAdapter } from './adapters/whatsapp.adapter';

/**
 * Resolves a channel to its adapter.
 *
 * Built from injected instances rather than a static map so an adapter can
 * take its own dependencies (an HTTP client, config) without the registry
 * knowing. Adding a provider is one class plus one line here — which is the
 * §47 Phase 8 acceptance criterion stated as code.
 */
@Injectable()
export class ChannelRegistry {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  constructor(line: LineAdapter, facebook: FacebookAdapter, whatsapp: WhatsappAdapter) {
    for (const adapter of [line, facebook, whatsapp]) {
      this.adapters.set(adapter.channel, adapter);
    }
  }

  get(channel: ChannelType): ChannelAdapter {
    const adapter = this.adapters.get(channel);

    if (!adapter) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `Unsupported channel: ${channel}`,
      });
    }

    return adapter;
  }

  has(channel: string): channel is ChannelType {
    return this.adapters.has(channel as ChannelType);
  }

  /** Credential keys an integration for this channel must carry. */
  requiredCredentials(channel: ChannelType): readonly string[] {
    return this.get(channel).requiredCredentials;
  }
}
