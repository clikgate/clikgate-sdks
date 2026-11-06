import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFromFlutterwave, buildFromMonnify, buildFromPaystack, buildFromStripe, InvalidRequestError, PrivateModeFieldRejectedError } from '../../src/index.js';
import { capture, client } from './helpers.js';

const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';

test('amounts are exact decimals: no float arithmetic, shortest form', () => {
  const ps = (amount: unknown, currency = 'NGN') => buildFromPaystack({ data: { reference: 'T', status: 'success', amount, currency } })?.amount;
  assert.equal(ps(750000), '7500');
  assert.equal(ps(10050, 'GHS'), '100.5');
  assert.equal(ps('5000'), '50');
  assert.equal(ps(1), '0.01');
  assert.equal(ps(0), '0');
  assert.equal(ps(10n ** 20n), '1000000000000000000');
  assert.equal(ps(-100), undefined);
  assert.equal(ps('abc'), undefined);
  const fw = (amount: unknown) => buildFromFlutterwave({ data: { tx_ref: 'F', status: 'successful', amount, currency: 'NGN' } })?.amount;
  assert.equal(fw(0.1 + 0.2), '0.30000000000000004'); // the float's own shortest text, unchanged
  assert.equal(fw(1500.25), '1500.25');
  assert.equal(fw('10.70'), '10.7');
  assert.equal(fw('1e3'), '1000');
  assert.equal(fw(1e21), '1000000000000000000000');
  assert.equal(fw('0.000'), '0');
  const st = (amount: unknown, currency: string) => buildFromStripe({ id: 'pi_1', object: 'payment_intent', status: 'succeeded', amount_received: amount, currency })?.amount;
  assert.equal(st(2000, 'usd'), '20');
  assert.equal(st(500, 'jpy'), '500');
  assert.equal(st(50000, 'isk'), '500');
  assert.equal(st(50000, 'ugx'), '500');
  assert.equal(st(1999, 'eur'), '19.99');
});

test('times: ISO and Unix seconds to UTC; other formats omitted', () => {
  const t = (paidOn: unknown) => buildFromMonnify({ responseBody: { paymentReference: 'M', paymentStatus: 'PAID', paidOn } })?.occurred_at;
  assert.equal(t('2026-10-28T11:00:00+01:00'), '2026-10-28T10:00:00Z');
  assert.equal(t('2026-10-28 10:00:00.5'), '2026-10-28T10:00:00.500Z');
  assert.equal(t('2026-10-28T10:00:00.123456Z'), '2026-10-28T10:00:00.123Z');
  assert.equal(t('2026-10-28T12:00-0200'), '2026-10-28T14:00:00Z');
  assert.equal(t('28/10/2026 10:00:00 AM'), undefined);
  assert.equal(t('2026-13-01T00:00:00Z'), undefined);
  assert.equal(t(1793016000), '2026-10-26T12:00:00Z');
  assert.equal(t(1793016000123), '2026-10-26T12:00:00.123Z');
});

test('helpers never read customer data', () => {
  const body = buildFromPaystack({
    data: { reference: 'T', status: 'success', amount: 100, currency: 'ngn', customer: { email: 'ada@example.com' }, authorization: { last4: '4081' }, metadata: JSON.stringify({ cg_click_id: CLICK, email: 'x' }) },
  });
  assert.deepEqual(body, { provider: 'paystack', reference: 'T', status: 'success', amount: '1', currency: 'NGN', click_id: CLICK });
  assert.ok(!JSON.stringify(body).includes('example.com'));
});

test('aliases: trimmed, deduplicated, never the reference, at most 5', () => {
  assert.deepEqual(buildFromFlutterwave({ data: { tx_ref: 'F', status: 'successful', id: 12, flw_ref: ' 12 ' } })?.aliases, ['12']);
  assert.equal(buildFromFlutterwave({ data: { tx_ref: '12', status: 'successful', id: 12 } })?.aliases, undefined);
});

test('confirm: local validation sends nothing', async () => {
  const { calls, fetchLike } = capture();
  const c = client(fetchLike);
  await assert.rejects(c.payments.confirm({ provider: 'paystack', reference: 'T', status: 'paid' as never }), (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_status');
  await assert.rejects(c.payments.confirm({ provider: 'paystack', reference: 'T', status: 'success', amount: '1', amountMinor: 100 }), (e: unknown) => e instanceof InvalidRequestError && e.code === 'amount_and_amount_minor');
  await assert.rejects(c.payments.confirm({ provider: 'paystack', reference: 'T', status: 'success', amountMinor: 1.5 }), (e: unknown) => e instanceof InvalidRequestError && e.param === 'amount_minor');
  assert.equal(calls.length, 0);
});

test('confirm: private-mode guard refuses extra fields before the transport', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: { object: 'payment_confirmation', id: 'pcf_1' } }]);
  const c = client(fetchLike, { privateMode: true });
  await assert.rejects(
    c.payments.confirm({ provider: 'paystack', reference: 'T', status: 'success', extra: { email: 'ada@example.com' } }),
    (e: unknown) => e instanceof PrivateModeFieldRejectedError && e.field === 'email' && !e.message.includes('ada@'),
  );
  assert.equal(calls.length, 0);
  await c.payments.confirm({ provider: 'paystack', reference: 'T', status: 'success', amount: 7500n, currency: 'NGN', aliases: ['A'], clickId: CLICK, goal: 'order_paid', test: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url.endsWith('/v1/payments/confirmations'), true);
  assert.deepEqual(JSON.parse(calls[0]!.body), { provider: 'paystack', reference: 'T', status: 'success', amount: '7500', currency: 'NGN', aliases: ['A'], click_id: CLICK, goal: 'order_paid', test: false });
});

test('fromStripe: no_payment_required sends nothing and does not warn', async () => {
  const warned: unknown[] = [];
  const { calls, fetchLike } = capture();
  const c = client(fetchLike, { logger: { warn: (_m, ctx) => warned.push(ctx?.code), error: () => undefined } });
  assert.equal(await c.payments.fromStripe({ id: 'cs_1', object: 'checkout.session', payment_status: 'no_payment_required' }), null);
  assert.equal(await c.payments.fromPaystack({ status: false }), null);
  assert.deepEqual(warned, ['unrecognised_payment_response']);
  assert.equal(calls.length, 0);
});
