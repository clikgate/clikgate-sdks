import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashForAds, InvalidRequestError, PrivateModeFieldRejectedError } from '../../src/index.js';
import { capture, client } from './helpers.js';

// The website's vectors (clikgate_website apps/www/samples/ads-hashing/, SPEC 25)
const H_EMAIL = '0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed';
const H_E164 = '6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c';
const H_DIGITS = 'fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17';
const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';

test('hashForAds: the documented vectors', () => {
  assert.deepEqual(hashForAds({ email: '  Ada.Obi@Example.com ', phone: '+234 803 123 4567' }), {
    hashedEmail: H_EMAIL,
    hashedPhoneE164: H_E164,
    hashedPhoneDigits: H_DIGITS,
  });
  assert.deepEqual(hashForAds({ phone: '00234 (803) 123-4567' }), { hashedPhoneE164: H_E164, hashedPhoneDigits: H_DIGITS });
  assert.deepEqual(hashForAds({ phone: '\t+2348031234567\n' }), { hashedPhoneE164: H_E164, hashedPhoneDigits: H_DIGITS });
  assert.deepEqual(hashForAds({ email: 'ADA.OBI@EXAMPLE.COM', phone: null }), { hashedEmail: H_EMAIL });
  assert.deepEqual(hashForAds({}), {});
});

test('hashForAds: a national number, a short number or an email without @ is refused without echoing it', () => {
  for (const [field, input] of [
    ['phone', '0803 123 4567'],
    ['phone', '2348031234567'],
    ['phone', '+12345'],
    ['phone', '+0803 123 4567'],
    ['phone', '+1234567890123456'],
    ['phone', ''],
    ['email', 'ada.obi.example.com'],
    ['email', '   '],
  ] as const) {
    assert.throws(
      () => hashForAds({ [field]: input }),
      (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_argument' && e.param === field && e.httpStatus === null && (input.trim() === '' || !e.message.includes(input.trim())),
      `${field} ${input}`,
    );
  }
});

test('goals carry the hashed options; a malformed hash is refused locally and nothing is sent', async () => {
  const { calls, fetchLike } = capture([{ status: 201, json: { object: 'goal_event', status: 'counted' } }]);
  const c = client(fetchLike);
  await c.goals.send('account_opened', { reference: 'APP-1', clickId: CLICK, ...hashForAds({ email: 'ada.obi@example.com', phone: '+2348031234567' }) });
  assert.deepEqual(JSON.parse(calls[0]!.body), {
    goal: 'account_opened',
    reference: 'APP-1',
    click_id: CLICK,
    hashed_email: H_EMAIL,
    hashed_phone_e164: H_E164,
    hashed_phone_digits: H_DIGITS,
  });
  for (const [option, field, value] of [
    ['hashedEmail', 'hashed_email', H_EMAIL.toUpperCase()],
    ['hashedPhoneE164', 'hashed_phone_e164', '+2348031234567'],
    ['hashedPhoneDigits', 'hashed_phone_digits', H_DIGITS.slice(1)],
  ] as const) {
    await assert.rejects(
      c.goals.send('account_opened', { reference: 'APP-2', [option]: value }),
      (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_hashed_identifier' && e.param === field && !e.message.includes(value),
    );
  }
  await assert.rejects(c.conversions.create({ external_id: 'ORD-1', hashed_email: 'ada@example.com' }), (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_hashed_identifier');
  assert.equal(calls.length, 1);
});

test('private mode: the guard allows the hashed fields on goals and conversions, not raw customer details', async () => {
  const { calls, fetchLike } = capture([
    { status: 201, json: { object: 'goal_event', status: 'counted' } },
    { status: 201, json: { object: 'conversion', id: 'cnv_1' } },
  ]);
  const c = client(fetchLike, { privateMode: true });
  await c.goals.send('account_opened', { reference: 'APP-1', hashedEmail: H_EMAIL });
  await c.conversions.create({ external_id: 'ORD-1', goal: 'order_paid', hashed_phone_e164: H_E164, hashed_phone_digits: H_DIGITS });
  await assert.rejects(c.conversions.create({ external_id: 'ORD-2', customer: { email: 'ada@example.com' } }), PrivateModeFieldRejectedError);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1]!.body).hashed_phone_digits, H_DIGITS);
});
