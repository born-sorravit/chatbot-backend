/**
 * External messaging channels (master plan §47 Phase 8).
 *
 * `web` is the built-in widget and has no integration row, no credentials and
 * no outbound delivery — it is delivered over WebSocket. The other three are
 * *external*: a message the AI or an admin writes has to be pushed back out
 * over the provider's API, which is the whole reason this phase exists.
 */
export enum ChannelType {
  Web = 'web',
  Line = 'line',
  Facebook = 'facebook',
  Whatsapp = 'whatsapp',
}

/** Kept for the pre-Phase-8 call sites that hard-coded the widget channel. */
export const CHANNEL_WEB = ChannelType.Web;

/** Channels that have an integration row and require outbound delivery. */
export const EXTERNAL_CHANNELS: readonly ChannelType[] = [
  ChannelType.Line,
  ChannelType.Facebook,
  ChannelType.Whatsapp,
];

export function isExternalChannel(channel: string): channel is ChannelType {
  return (EXTERNAL_CHANNELS as readonly string[]).includes(channel);
}

/** Outcome of one delivery attempt, stored on the message metadata. */
export enum ChannelDeliveryStatus {
  Pending = 'PENDING',
  Delivered = 'DELIVERED',
  Failed = 'FAILED',
  /** No integration, or the integration was switched off after the message. */
  Skipped = 'SKIPPED',
}

/**
 * Outbound delivery job id.
 *
 * Derived from the message id for the same reason as `aiResponseJobId`
 * (TD-10): a duplicate enqueue must not send the customer the same LINE
 * message twice. Hyphen, not colon — BullMQ 6 rejects ':' in a custom id.
 */
export const channelDeliveryJobId = (messageId: string): string => `channel-send-${messageId}`;

/**
 * Largest webhook body the controller will hash.
 *
 * The cap matters because the signature is computed over the whole raw body:
 * without one, an unauthenticated endpoint would let anyone make the server
 * HMAC an arbitrarily large buffer before the signature can reject it.
 *
 * Set to Express's own default JSON limit rather than above it. The body
 * parser rejects anything larger first, so a higher number here would
 * describe a guard that can never fire — real provider payloads are
 * single-digit KB, so neither limit is reached in practice. Keeping the two
 * equal means this constant states the intent and still protects the HMAC if
 * the parser limit is ever raised.
 */
export const WEBHOOK_MAX_BODY_BYTES = 100 * 1024;
