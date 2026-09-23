import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison of two signature strings.
 *
 * `timingSafeEqual` throws when the buffers differ in length, and an early
 * length check would itself leak length — so both are normalised through a
 * fixed-width HMAC first. The result is that an attacker learns nothing from
 * how long the comparison took, which is the whole point of the exercise.
 */
export function safeCompare(a: string, b: string): boolean {
  const key = 'signature-comparison';
  const left = createHmac('sha256', key).update(a).digest();
  const right = createHmac('sha256', key).update(b).digest();
  return timingSafeEqual(left, right);
}

/** LINE: base64 HMAC-SHA256 of the raw body, keyed by the channel secret. */
export function lineSignature(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** Meta (Facebook / WhatsApp): `sha256=` + hex HMAC-SHA256 of the raw body. */
export function metaSignature(appSecret: string, rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** Normalises a header that Node may hand back as an array. */
export function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const raw = headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}
