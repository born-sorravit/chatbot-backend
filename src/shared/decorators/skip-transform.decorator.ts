import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skip_transform';

/**
 * Returns the handler's value as-is, without the `{ data }` envelope.
 *
 * Exists for Meta's webhook subscription handshake, which requires the bare
 * `hub.challenge` string in the body. Wrapping it makes Meta reject the
 * subscription, and the failure message points at the URL rather than at the
 * envelope — so this is worth a decorator rather than a special case.
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
