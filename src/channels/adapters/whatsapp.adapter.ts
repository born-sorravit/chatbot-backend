import { Injectable, Logger } from '@nestjs/common';
import { ChannelType } from '../../common/constants';
import type { ChannelCredentials } from '../../database/entities';
import type {
  ChannelAdapter,
  OutboundMessage,
  ParsedWebhook,
  VerifyContext,
} from '../channel-adapter.interface';
import { metaHandshake, verifyMetaSignature } from './facebook.adapter';

const GRAPH_VERSION = 'v21.0';

interface WhatsappWebhookBody {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
}

/**
 * WhatsApp Cloud API.
 *
 * **Not verified against the live API** — no Meta credentials were available
 * (TD-25 / TD-28). Signature verification is exercised offline; the Graph
 * call is not.
 *
 * Reuses Facebook's signature and handshake helpers: both are Meta products
 * and share `X-Hub-Signature-256` exactly. The payload shapes, however, have
 * nothing in common, which is why this is a separate adapter rather than a
 * flag on the Facebook one.
 */
@Injectable()
export class WhatsappAdapter implements ChannelAdapter {
  readonly channel = ChannelType.Whatsapp;
  readonly requiredCredentials = ['appSecret', 'accessToken', 'verifyToken', 'phoneNumberId'] as const;

  private readonly logger = new Logger(WhatsappAdapter.name);

  verify({ rawBody, headers, credentials }: VerifyContext): boolean {
    return verifyMetaSignature(rawBody, headers, credentials);
  }

  handleVerification(
    query: Record<string, string | undefined>,
    credentials: ChannelCredentials,
  ): string | null {
    return metaHandshake(query, credentials);
  }

  parse(rawBody: Buffer): ParsedWebhook {
    const body = JSON.parse(rawBody.toString('utf8')) as WhatsappWebhookBody;
    const value = body.entry?.[0]?.changes?.[0]?.value;

    // The contacts array carries the display name for the same wa_id.
    const names = new Map(
      (value?.contacts ?? [])
        .filter((c) => c.wa_id)
        .map((c) => [c.wa_id as string, c.profile?.name ?? null]),
    );

    const messages = (value?.messages ?? []).flatMap((message) => {
      const externalUserId = message.from;
      const externalMessageId = message.id;
      const text = message.text?.body;

      if (!externalUserId || !externalMessageId || message.type !== 'text' || !text) {
        return [];
      }

      return [
        {
          externalMessageId,
          externalUserId,
          text,
          displayName: names.get(externalUserId) ?? null,
          // WhatsApp sends unix *seconds* as a string, unlike LINE's
          // milliseconds — multiplying is the difference between 2026 and 1970.
          sentAt: message.timestamp ? new Date(Number(message.timestamp) * 1000) : null,
        },
      ];
    });

    return { externalAccountId: value?.metadata?.phone_number_id ?? null, messages };
  }

  async send(credentials: ChannelCredentials, message: OutboundMessage): Promise<void> {
    const { accessToken, phoneNumberId } = credentials;

    if (!accessToken || !phoneNumberId) {
      throw new Error('WhatsApp integration is missing accessToken or phoneNumberId');
    }

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.externalUserId,
          type: 'text',
          text: { body: message.text },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`WhatsApp send failed (${response.status}): ${detail}`);
    }

    this.logger.debug({ event: 'whatsapp.sent' });
  }
}
