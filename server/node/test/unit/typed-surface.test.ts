import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EventType, currencyExponent, minorToAmount, webhooks } from '../../src/index.js';

const SECRET = 'whsec_unit_typed';
const sign = (body: string, t: number) => `t=${t},v1=${createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex')}`;
const verify = (type: string, object: unknown) => {
  const body = JSON.stringify({ id: 'evt_1', object: 'event', type, api_version: '2026-10-01', created_at: '2026-10-26T12:00:00Z', organization_id: 'org_1', livemode: false, data: { object, previous_attributes: null } });
  return { body, event: webhooks.verify(body, sign(body, 1_793_016_000), SECRET, { now: 1_793_016_000 }) };
};

test('minorToAmount: the currency exponent, exact digits, no float', () => {
  assert.equal(minorToAmount(50000, 'NGN'), '500.00');
  assert.equal(minorToAmount(5, 'usd'), '0.05');
  assert.equal(minorToAmount(1500, 'JPY'), '1500');
  assert.equal(minorToAmount(12345, 'KWD'), '12.345');
  assert.equal(minorToAmount(1, 'CLF'), '0.0001');
  assert.equal(minorToAmount(9007199254740993n, 'NGN'), '90071992547409.93');
  assert.equal(minorToAmount(-250, 'NGN'), '-2.50');
  assert.equal(currencyExponent('XYZ'), 2);
});

test('webhook accessors: typed objects, null on a mismatch, JSON unchanged', () => {
  const referral = { object: 'referral', id: 'ref_1', reward_snapshot: { referrer: { amount_minor: 50000, currency: 'NGN' } } };
  const { body, event } = verify(EventType.ReferralQualified, referral);
  assert.equal(event.asReferral()?.reward_snapshot?.referrer?.amount, '500.00');
  assert.equal(event.asReferrer(), null);
  assert.equal(event.asGoalEvent(), null);
  assert.equal(JSON.stringify(event), body);
  assert.deepEqual(Object.keys(event).sort(), ['api_version', 'created_at', 'data', 'id', 'livemode', 'object', 'organization_id', 'type']);
  // the raw data is untouched (no amount added there)
  assert.equal((event.data.object as { reward_snapshot: { referrer: Record<string, unknown> } }).reward_snapshot.referrer.amount, undefined);
  const typed = event.typed();
  if (typed.type === EventType.ReferralQualified) assert.equal(typed.data.object.id, 'ref_1');
  else assert.fail('narrowing');
});

test('webhook accessors: every family, and data.object that is not an object', () => {
  assert.equal(verify('goal.completed', { object: 'goal_event', id: 'cnv_1' }).event.asGoalEvent()?.id, 'cnv_1');
  assert.equal(verify('install.organic', { object: 'install', id: 'ins_1' }).event.asInstall()?.id, 'ins_1');
  assert.equal(verify('payment.refunded', { object: 'payment_report', id: 'prp_1' }).event.asPayment()?.id, 'prp_1');
  assert.equal(verify('conversion.reversed', { object: 'conversion', id: 'cnv_2' }).event.asConversion()?.id, 'cnv_2');
  assert.equal(verify('referrer.created', { object: 'referrer', id: 'rfr_1' }).event.asReferrer()?.id, 'rfr_1');
  assert.equal(verify('referral.created', 'ref_1').event.asReferral(), null);
  assert.equal(verify('app.reengaged', { object: 'install', id: 'ins_1' }).event.asInstall(), null);
});

test('EventType: 97 unique wire strings', () => {
  const values = Object.values(EventType);
  assert.equal(values.length, 97);
  assert.equal(new Set(values).size, 97);
  assert.equal(EventType.LinkStatsHourly, 'link.stats.hourly');
});
