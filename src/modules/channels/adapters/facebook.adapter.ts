import { Injectable, Logger } from '@nestjs/common';
import { ChannelType } from '@/shared/constants';
import type { ChannelCredentials } from '@/models/entities';
import type {
  ChannelAdapter,
  OutboundMessage,
  ParsedWebhook,
  VerifyContext,
} from '@/modules/channels/channel-adapter.interface';
import { headerValue, metaSignature, safeCompare } from './signature';

const GRAPH_VERSION = 'v21.0';

interface MessengerWebhookBody {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: Array<{
      sender?: { id?: string };
      timestamp?: number;
      message?: { mid?: string; text?: string; is_echo?: boolean };
    }>;
  }>;
}

/**
 * Facebook Messenger.
 *
 * **Not verified against the live API** — no Meta app credentials were
 * available (TD-25 / TD-28 again). Signature verification is exercised
 * offline against byte-exact fixtures; the Graph API call is not.
 *
 * Shares its signature scheme and GET handshake with WhatsApp because both
 * are Meta products — see `MetaVerification` below, which is the piece both
 * adapters reuse.
 */
@Injectable()
export class FacebookAdapter implements ChannelAdapter {
  readonly channel = ChannelType.Facebook;
  readonly requiredCredentials = ['appSecret', 'accessToken', 'verifyToken'] as const;

  private readonly logger = new Logger(FacebookAdapter.name);

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
    const body = JSON.parse(rawBody.toString('utf8')) as MessengerWebhookBody;
    const entry = body.entry?.[0];

    const messages = (entry?.messaging ?? []).flatMap((event) => {
      const externalUserId = event.sender?.id;
      const externalMessageId = event.message?.mid;
      const text = event.message?.text;

      // `is_echo` marks the page's own outgoing message being reflected back.
      // Storing it would double every reply we just sent and, worse, feed the
      // AI its own words as if the customer had said them.
      if (!externalUserId || !externalMessageId || !text || event.message?.is_echo) {
        return [];
      }

      return [
        {
          externalMessageId,
          externalUserId,
          text,
          sentAt: event.timestamp ? new Date(event.timestamp) : null,
        },
      ];
    });

    return { externalAccountId: entry?.id ?? null, messages };
  }

  async send(credentials: ChannelCredentials, message: OutboundMessage): Promise<void> {
    const accessToken = credentials.accessToken;

    if (!accessToken) {
      throw new Error('Facebook integration is missing accessToken');
    }

    const response = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: message.externalUserId },
          messaging_type: 'RESPONSE',
          message: { text: message.text },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Messenger send failed (${response.status}): ${detail}`);
    }

    this.logger.debug({ event: 'facebook.sent' });
  }
}

/**
 * Meta signs with `X-Hub-Signature-256`, hex, prefixed `sha256=`.
 *
 * Shared by both Meta adapters rather than duplicated: a signature check
 * copy-pasted into two files is a check that gets fixed in one of them.
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  credentials: ChannelCredentials,
): boolean {
  const provided = headerValue(headers, 'x-hub-signature-256');
  const appSecret = credentials.appSecret;

  if (!provided || !appSecret) {
    return false;
  }

  return safeCompare(provided, metaSignature(appSecret, rawBody));
}

/**
 * Meta's subscription handshake: a GET carrying `hub.challenge`, which must
 * be echoed verbatim — but only when `hub.verify_token` matches the one the
 * admin configured. Without that check anyone could confirm the subscription.
 */
export function metaHandshake(
  query: Record<string, string | undefined>,
  credentials: ChannelCredentials,
): string | null {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  const expected = credentials.verifyToken;

  if (mode !== 'subscribe' || !challenge || !token || !expected) {
    return null;
  }

  return safeCompare(token, expected) ? challenge : null;
}
