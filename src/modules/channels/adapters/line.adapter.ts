import { Injectable, Logger } from '@nestjs/common';
import { ChannelType } from '@/shared/constants';
import type { ChannelCredentials } from '@/models/entities';
import type {
  ChannelAdapter,
  OutboundMessage,
  ParsedWebhook,
  VerifyContext,
} from '@/modules/channels/channel-adapter.interface';
import { headerValue, lineSignature, safeCompare } from './signature';

const LINE_REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

/** LINE's webhook envelope, narrowed to the fields this adapter reads. */
interface LineWebhookBody {
  destination?: string;
  events?: Array<{
    type?: string;
    replyToken?: string;
    timestamp?: number;
    source?: { userId?: string; type?: string };
    message?: { id?: string; type?: string; text?: string };
  }>;
}

/**
 * LINE Messaging API.
 *
 * **Not verified against the live API** — no channel credentials were
 * available while building (the same position as TD-25 and TD-28). The
 * signature scheme, the webhook envelope and the reply/push contract are
 * implemented from the published specification, and the signature half *is*
 * fully exercised offline against byte-exact fixtures, because that is the
 * part protecting a public endpoint. The HTTP calls are not.
 */
@Injectable()
export class LineAdapter implements ChannelAdapter {
  readonly channel = ChannelType.Line;
  readonly requiredCredentials = ['channelSecret', 'accessToken'] as const;

  private readonly logger = new Logger(LineAdapter.name);

  verify({ rawBody, headers, credentials }: VerifyContext): boolean {
    const provided = headerValue(headers, 'x-line-signature');
    const secret = credentials.channelSecret;

    if (!provided || !secret) {
      return false;
    }

    return safeCompare(provided, lineSignature(secret, rawBody));
  }

  parse(rawBody: Buffer): ParsedWebhook {
    const body = JSON.parse(rawBody.toString('utf8')) as LineWebhookBody;

    const messages = (body.events ?? [])
      // Only text messages become conversation content. A follow/unfollow or
      // a sticker is a real event that this MVP has nothing to say about, and
      // turning it into an empty message would wake the AI for nothing.
      .filter((event) => event.type === 'message' && event.message?.type === 'text')
      .flatMap((event) => {
        const externalUserId = event.source?.userId;
        const externalMessageId = event.message?.id;
        const text = event.message?.text;

        if (!externalUserId || !externalMessageId || !text) {
          return [];
        }

        return [
          {
            externalMessageId,
            externalUserId,
            text,
            replyToken: event.replyToken ?? null,
            sentAt: event.timestamp ? new Date(event.timestamp) : null,
          },
        ];
      });

    return { externalAccountId: body.destination ?? null, messages };
  }

  /**
   * Replies with the per-message reply token when one is still in hand, and
   * falls back to push otherwise.
   *
   * The distinction is not cosmetic: reply is free and push is billed per
   * message on most LINE plans, so defaulting to push would quietly cost the
   * business money on every AI answer.
   */
  async send(credentials: ChannelCredentials, message: OutboundMessage): Promise<void> {
    const accessToken = credentials.accessToken;

    if (!accessToken) {
      throw new Error('LINE integration is missing accessToken');
    }

    const useReply = Boolean(message.replyToken);
    const url = useReply ? LINE_REPLY_URL : LINE_PUSH_URL;
    const payload = useReply
      ? { replyToken: message.replyToken, messages: [{ type: 'text', text: message.text }] }
      : { to: message.externalUserId, messages: [{ type: 'text', text: message.text }] };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // Thrown, not swallowed: the delivery worker's retry is what makes a
      // transient LINE outage recoverable, and swallowing here would turn a
      // retryable failure into a message the customer never receives.
      throw new Error(`LINE ${useReply ? 'reply' : 'push'} failed (${response.status}): ${detail}`);
    }

    this.logger.debug({ event: 'line.sent', mode: useReply ? 'reply' : 'push' });
  }
}
