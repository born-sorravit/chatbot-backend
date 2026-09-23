import { createHmac } from 'node:crypto';
import { LineAdapter } from './line.adapter';
import { FacebookAdapter } from './facebook.adapter';
import { WhatsappAdapter } from './whatsapp.adapter';
import { lineSignature, metaSignature, safeCompare } from './signature';

/**
 * Signature verification is the only thing authenticating a public webhook,
 * so it is tested against byte-exact fixtures rather than round-tripped
 * through the adapter's own helper.
 *
 * The fixtures deliberately contain whitespace and non-alphabetical key order
 * that `JSON.stringify(JSON.parse(x))` would not reproduce. A verifier that
 * re-serialises the body passes a naive test and fails against every real
 * provider; these bodies catch that.
 */
describe('channel signature verification', () => {
  const LINE_SECRET = 'line-channel-secret';
  const META_SECRET = 'meta-app-secret';

  // Note the spacing and the key order — this is the point of the fixture.
  const LINE_BODY = Buffer.from(
    '{"destination":"Uabc",  "events":[{"type":"message","replyToken":"rt-1","source":{"userId":"U123","type":"user"},"message":{"id":"m-1","type":"text","text":"สวัสดี"}}]}',
    'utf8',
  );

  const META_BODY = Buffer.from(
    '{"object":"page", "entry":[{"id":"page-1","messaging":[{"sender":{"id":"psid-1"},"message":{"mid":"mid-1","text":"hello"}}]}]}',
    'utf8',
  );

  describe('safeCompare', () => {
    it('accepts identical strings', () => {
      expect(safeCompare('abc', 'abc')).toBe(true);
    });

    it('rejects different strings', () => {
      expect(safeCompare('abc', 'abd')).toBe(false);
    });

    it('rejects strings of different length without throwing', () => {
      // timingSafeEqual throws on length mismatch; hashing first is what
      // keeps this a comparison rather than a crash.
      expect(() => safeCompare('short', 'much-longer-value')).not.toThrow();
      expect(safeCompare('short', 'much-longer-value')).toBe(false);
    });
  });

  describe('LINE', () => {
    const adapter = new LineAdapter();
    const credentials = { channelSecret: LINE_SECRET, accessToken: 'token' };

    it('accepts a signature over the exact bytes', () => {
      const signature = createHmac('sha256', LINE_SECRET).update(LINE_BODY).digest('base64');

      expect(
        adapter.verify({
          rawBody: LINE_BODY,
          headers: { 'x-line-signature': signature },
          credentials,
        }),
      ).toBe(true);
    });

    it('rejects a signature computed over a re-serialised body', () => {
      // This is the failure mode the raw body exists to prevent: same JSON,
      // different bytes, so the HMAC differs.
      const reserialised = Buffer.from(JSON.stringify(JSON.parse(LINE_BODY.toString())), 'utf8');
      expect(reserialised.equals(LINE_BODY)).toBe(false);

      const signature = createHmac('sha256', LINE_SECRET).update(reserialised).digest('base64');

      expect(
        adapter.verify({
          rawBody: LINE_BODY,
          headers: { 'x-line-signature': signature },
          credentials,
        }),
      ).toBe(false);
    });

    it('rejects a body altered after signing', () => {
      const signature = lineSignature(LINE_SECRET, LINE_BODY);
      const tampered = Buffer.from(LINE_BODY.toString().replace('สวัสดี', 'ยกเลิกคำสั่งซื้อ'));

      expect(
        adapter.verify({
          rawBody: tampered,
          headers: { 'x-line-signature': signature },
          credentials,
        }),
      ).toBe(false);
    });

    it('rejects a signature made with the wrong secret', () => {
      const signature = lineSignature('not-the-secret', LINE_BODY);

      expect(
        adapter.verify({
          rawBody: LINE_BODY,
          headers: { 'x-line-signature': signature },
          credentials,
        }),
      ).toBe(false);
    });

    it('rejects a missing signature header', () => {
      expect(adapter.verify({ rawBody: LINE_BODY, headers: {}, credentials })).toBe(false);
    });

    it('rejects when the integration has no secret configured', () => {
      expect(
        adapter.verify({
          rawBody: LINE_BODY,
          headers: { 'x-line-signature': lineSignature(LINE_SECRET, LINE_BODY) },
          credentials: { accessToken: 'token' },
        }),
      ).toBe(false);
    });

    it('parses a text message', () => {
      const parsed = adapter.parse(LINE_BODY);

      expect(parsed.externalAccountId).toBe('Uabc');
      expect(parsed.messages).toEqual([
        {
          externalMessageId: 'm-1',
          externalUserId: 'U123',
          text: 'สวัสดี',
          replyToken: 'rt-1',
          sentAt: null,
        },
      ]);
    });

    it('ignores non-text events', () => {
      const body = Buffer.from(
        '{"events":[{"type":"follow","source":{"userId":"U1"}},{"type":"message","source":{"userId":"U1"},"message":{"id":"m","type":"sticker"}}]}',
      );
      expect(adapter.parse(body).messages).toEqual([]);
    });
  });

  describe('Meta (Facebook / WhatsApp)', () => {
    const facebook = new FacebookAdapter();
    const whatsapp = new WhatsappAdapter();
    const credentials = {
      appSecret: META_SECRET,
      accessToken: 'token',
      verifyToken: 'verify-me',
      phoneNumberId: '555',
    };

    it('accepts a sha256= prefixed hex signature', () => {
      expect(
        facebook.verify({
          rawBody: META_BODY,
          headers: { 'x-hub-signature-256': metaSignature(META_SECRET, META_BODY) },
          credentials,
        }),
      ).toBe(true);
    });

    it('rejects a signature missing the sha256= prefix', () => {
      const bare = createHmac('sha256', META_SECRET).update(META_BODY).digest('hex');

      expect(
        facebook.verify({
          rawBody: META_BODY,
          headers: { 'x-hub-signature-256': bare },
          credentials,
        }),
      ).toBe(false);
    });

    it('applies the same check for WhatsApp', () => {
      expect(
        whatsapp.verify({
          rawBody: META_BODY,
          headers: { 'x-hub-signature-256': metaSignature(META_SECRET, META_BODY) },
          credentials,
        }),
      ).toBe(true);
    });

    it('drops the page echo of its own outgoing message', () => {
      // Without this the AI would be fed its own reply as customer input.
      const body = Buffer.from(
        '{"entry":[{"id":"p1","messaging":[{"sender":{"id":"page"},"message":{"mid":"m1","text":"our reply","is_echo":true}}]}]}',
      );
      expect(facebook.parse(body).messages).toEqual([]);
    });

    it('parses a WhatsApp text message with its contact name', () => {
      const body = Buffer.from(
        '{"entry":[{"changes":[{"value":{"metadata":{"phone_number_id":"555"},"contacts":[{"wa_id":"66812345678","profile":{"name":"สมชาย"}}],"messages":[{"id":"wamid.1","from":"66812345678","timestamp":"1790000000","type":"text","text":{"body":"ราคาเท่าไหร่"}}]}}]}]}',
      );

      const parsed = whatsapp.parse(body);

      expect(parsed.externalAccountId).toBe('555');
      expect(parsed.messages[0]).toMatchObject({
        externalMessageId: 'wamid.1',
        externalUserId: '66812345678',
        text: 'ราคาเท่าไหร่',
        displayName: 'สมชาย',
      });
      // Seconds, not milliseconds — the difference between 2026 and 1970.
      expect(parsed.messages[0].sentAt?.getUTCFullYear()).toBe(2026);
    });

    describe('subscription handshake', () => {
      it('echoes the challenge when the verify token matches', () => {
        expect(
          facebook.handleVerification(
            { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' },
            credentials,
          ),
        ).toBe('12345');
      });

      it('refuses when the verify token is wrong', () => {
        expect(
          facebook.handleVerification(
            { 'hub.mode': 'subscribe', 'hub.verify_token': 'guessed', 'hub.challenge': '12345' },
            credentials,
          ),
        ).toBeNull();
      });

      it('refuses when the mode is not subscribe', () => {
        expect(
          facebook.handleVerification(
            { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1' },
            credentials,
          ),
        ).toBeNull();
      });
    });
  });
});
