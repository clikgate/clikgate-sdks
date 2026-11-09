import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GoalKind, GoalStatus, InvalidRequestError, Provider, type ApiTypes, type GoalEvent } from '../../src/index.js';
import { capture, client } from './helpers.js';

const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';

test('enums carry the wire values', () => {
  assert.equal(GoalKind.Payment, 'payment');
  assert.equal(GoalKind.Standard, 'standard');
  assert.deepEqual(Object.values(GoalStatus), ['counted', 'waiting', 'refused', 'received']);
  assert.equal(Provider.Paystack, 'paystack');
  assert.equal(Provider.MtnMomo, 'mtn_momo');
  assert.equal(Provider.Custom, 'custom');
  // the generated API types use the same values
  const kind: ApiTypes.GoalKind = GoalKind.Payment;
  const status: ApiTypes.GoalStatus = GoalStatus.Waiting;
  assert.equal(`${kind}/${status}`, 'payment/waiting');
});

test('goals.send sends provider and returns the GoalStatus result', async () => {
  const event = {
    object: 'goal_event',
    id: 'pcf_1',
    status: 'waiting',
    reason: 'waiting_for_confirmation',
    goal_kind: 'payment',
    counted: false,
    value_ignored: false,
    event_status: null,
    payment: { confirmation_id: 'pcf_1', match_status: 'waiting_for_report', report_id: null, provider: 'paystack' },
  };
  const { calls, fetchLike } = capture([{ status: 201, json: event }]);
  const c = client(fetchLike);
  const r: GoalEvent = await c.goals.send('order_paid', { reference: 'T123456', provider: Provider.Paystack, value: '7500', currency: 'NGN' });
  assert.deepEqual(JSON.parse(calls[0]!.body), { goal: 'order_paid', reference: 'T123456', provider: 'paystack', value: '7500', currency: 'NGN' });
  assert.equal(r.status, GoalStatus.Waiting);
  assert.equal(r.goal_kind, GoalKind.Payment);
  assert.equal(r.payment?.provider, Provider.Paystack);
});

test('provider: a newer gateway key is sent; a malformed one is refused locally', async () => {
  const { calls, fetchLike } = capture([{ status: 201, json: { object: 'goal_event', status: 'counted' } }]);
  const c = client(fetchLike);
  await c.goals.send('order_paid', { reference: 'T-1', provider: 'acme_pay', clickId: CLICK, value: '10' });
  assert.equal(JSON.parse(calls[0]!.body).provider, 'acme_pay');
  for (const bad of ['Paystack', 'mtn-momo', '', 'p']) {
    await assert.rejects(c.goals.send('order_paid', { reference: 'T-2', provider: bad }), (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_provider' && e.param === 'provider' && e.httpStatus === null);
  }
  await assert.rejects(c.goals.sendBatch([{ goal: 'order_paid', reference: 'A' }, { goal: 'order_paid', reference: 'B', provider: 'X' }]), (e: unknown) => e instanceof InvalidRequestError && e.index === 1);
  assert.equal(calls.length, 1);
});

test('private mode allows provider on goals and conversions', async () => {
  const { calls, fetchLike } = capture([{ status: 201, json: { object: 'goal_event' } }, { status: 201, json: { object: 'conversion' } }]);
  const c = client(fetchLike, { privateMode: true });
  await c.goals.send('order_paid', { reference: 'T-1', provider: Provider.Stripe });
  await c.conversions.create({ external_id: 'O-1', goal: 'order_paid', provider: 'stripe' });
  assert.equal(calls.length, 2);
});

test('unknown fields and enum values are kept, never an error', async () => {
  const { fetchLike } = capture([{ status: 201, json: { object: 'goal_event', status: 'deferred', goal_kind: 'subscription', future_field: { a: 1 } } }]);
  const c = client(fetchLike);
  const r = await c.goals.send('account_opened', { reference: 'APP-1' });
  assert.equal(r.status as string, 'deferred');
  assert.deepEqual(r.future_field, { a: 1 });
});

test('payments.confirm takes a Provider or a newer key', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: { object: 'payment_confirmation' } }, { status: 200, json: { object: 'payment_confirmation' } }]);
  const c = client(fetchLike);
  await c.payments.confirm({ provider: Provider.Flutterwave, reference: 'F-1', status: 'success', amount: '10', currency: 'NGN' });
  await c.payments.confirm({ provider: 'acme_pay', reference: 'A-1', status: 'success', amount: '10', currency: 'NGN' });
  assert.equal(JSON.parse(calls[0]!.body).provider, 'flutterwave');
  assert.equal(JSON.parse(calls[1]!.body).provider, 'acme_pay');
});
