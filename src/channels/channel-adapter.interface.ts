import type { ChannelType } from '../common/constants';
import type { ChannelCredentials } from '../database/entities';

/** One inbound message, normalised away from whatever the provider sent. */
export interface InboundMessage {
  /** The provider's message id — the inbound idempotency key. */
  externalMessageId: string;
  /** The provider's user id for the sender. */
  externalUserId: string;
  text: string;
  /** Display name when the payload carries one; profile lookups are not done. */
  displayName?: string | null;
  /** Provider timestamp, when supplied. */
  sentAt?: Date | null;
  /**
   * Opaque per-message token some providers need in order to reply
   * (LINE's replyToken). Short-lived, so the delivery worker treats its
   * absence as "use the push API" rather than as an error.
   */
  replyToken?: string | null;
}

/** What a verified webhook yielded. */
export interface ParsedWebhook {
  /**
   * The provider account the payload is addressed to, when it carries one.
   * Checked against the integration row so a valid signature from one
   * connected account cannot be replayed into another.
   */
  externalAccountId?: string | null;
  messages: InboundMessage[];
}

export interface OutboundMessage {
  externalUserId: string;
  text: string;
  replyToken?: string | null;
}

export interface VerifyContext {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  credentials: ChannelCredentials;
}

/**
 * One external messaging provider.
 *
 * The interface is deliberately narrow: verify, parse, send. Everything that
 * follows — resolving the customer, opening the conversation, storing the
 * message, waking the AI — is channel-independent and lives in
 * `ChannelInboundService`. That is what makes the phase's acceptance
 * criterion ("a second channel works without touching AI core") true by
 * construction rather than by discipline: an adapter cannot reach the
 * orchestrator even if it wanted to.
 */
export interface ChannelAdapter {
  readonly channel: ChannelType;

  /** Credential keys that must be present before the integration is usable. */
  readonly requiredCredentials: readonly string[];

  /**
   * Rejects a payload that the provider did not sign.
   *
   * This is the only thing standing between a public URL and someone
   * injecting messages into a business's inbox, so it must be constant-time
   * and must run over the *raw* bytes — `JSON.stringify(req.body)` re-orders
   * keys and drops whitespace, which passes a hand-written test and fails
   * against every real provider.
   */
  verify(context: VerifyContext): boolean;

  parse(rawBody: Buffer): ParsedWebhook;

  send(credentials: ChannelCredentials, message: OutboundMessage): Promise<void>;

  /**
   * Meta's GET handshake. Providers that don't use one return null and the
   * controller answers 404.
   */
  handleVerification?(
    query: Record<string, string | undefined>,
    credentials: ChannelCredentials,
  ): string | null;
}
