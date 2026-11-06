import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitise, userAgent } from '../../src/user-agent.js';
import { VERSION, formatValue, InvalidRequestError, Clikgate, ConfigurationError, PrivateModeFieldRejectedError } from '../../src/index.js';
import { capture, client, KEY } from './helpers.js';

test('VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(VERSION, pkg.version);
});

test('User-Agent follows SPEC section 4', () => {
  assert.equal(userAgent('linux', 'x64', '24.11.0'), `clikgate-node/${VERSION} (node 24.11.0; linux x64)`);
  assert.equal(userAgent('win32', 'ia32', '18.20.4'), `clikgate-node/${VERSION} (node 18.20.4; windows x86)`);
  assert.equal(sanitise('1.8.0_402'), '1.8.0-402');
  assert.match(userAgent(), /^clikgate-node\/\d+\.\d+\.\d+ \(node [^;]+; [a-z]+ [^)]+\)$/);
});

test('formatValue: decimal strings on the wire', () => {
  assert.equal(formatValue('1500.50'), '1500.50');
  assert.equal(formatValue(2_000_000), '2000000');
  assert.equal(formatValue(10n ** 20n), '100000000000000000000');
  const warned: string[] = [];
  assert.equal(formatValue(0.1, (m) => warned.push(m)), '0.1');
  assert.equal(warned.length, 1);
  assert.throws(() => formatValue('-1'), InvalidRequestError);
  assert.throws(() => formatValue({} as unknown as string), InvalidRequestError);
});

test('constructor reads CLIKGATE_API_KEY and refuses other key types', () => {
  process.env.CLIKGATE_API_KEY = 'cg_live_fromenv123';
  try {
    assert.equal(new Clikgate({ shutdownHooks: false }).mode, 'live');
  } finally {
    delete process.env.CLIKGATE_API_KEY;
  }
  assert.throws(() => new Clikgate({ shutdownHooks: false }), (e: unknown) => e instanceof ConfigurationError && e.code === 'missing_api_key');
  assert.throws(() => new Clikgate({ apiKey: 'cg_sdk_live_x', shutdownHooks: false }), (e: unknown) => e instanceof ConfigurationError && !e.message.includes('cg_sdk_live_x'));
});

test('private mode: nothing refused ever reaches the transport', async () => {
  const { calls, fetchLike } = capture([{ status: 201, json: { object: 'goal_event' } }]);
  const c = client(fetchLike, { privateMode: true });
  await assert.rejects(c.goals.send('account_opened', { reference: 'APP-1', metadata: { email: 'a@b.c' } }), PrivateModeFieldRejectedError);
  await assert.rejects(c.conversions.create({ external_id: 'X', customer: { phone: '0803' } }), PrivateModeFieldRejectedError);
  await assert.rejects(c.goals.reverse('order_paid', 'ORD-1', { reason: 'free text' }), PrivateModeFieldRejectedError);
  await assert.rejects(c.goals.sendBatch([{ goal: 'order_paid', reference: 'A' }, { goal: 'order_paid', reference: 'B', metadata: { x: 1 } }]), (e: unknown) => e instanceof PrivateModeFieldRejectedError && e.index === 1 && e.field === 'metadata');
  assert.equal(calls.length, 0);
  await c.goals.send('account_opened', { reference: 'APP-1', value: '5' });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]!.body), { goal: 'account_opened', reference: 'APP-1', value: '5' });
});

test('config is fetched once for concurrent callers', async () => {
  const cfg = { mode: 'test', organization_id: 'org_1', private_mode: false, click_id_param: 'ref', goals: [], minimum_sdk_versions: {} };
  const { calls, fetchLike } = capture([{ status: 200, json: cfg }]);
  const c = client(fetchLike, { privateMode: 'auto' });
  const [a, b] = await Promise.all([c.config(), c.config()]);
  assert.equal(a, b);
  assert.equal(calls.length, 1);
  assert.equal(c.clickIds.paramName, 'ref');
});

test('the generated api layer uses the same pipeline (auth, UA, query, errors)', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: { object: 'list', data: [], has_more: false, next_cursor: null } }, { status: 404, json: { error: { type: 'not_found', code: 'resource_missing', message: 'No such link.', param: null, request_id: 'req_1' } } }]);
  const c = client(fetchLike);
  await c.api.links.listLinks({ limit: 5, tag: 'promo' });
  assert.equal(calls[0]!.url, 'https://api.clikgate.com/v1/links?limit=5&tag=promo');
  assert.equal(calls[0]!.headers.authorization, `Bearer ${KEY}`);
  assert.match(calls[0]!.headers['user-agent']!, /^clikgate-node\//);
  await assert.rejects(c.api.links.fetchLink('lnk_x'), (e: unknown) => (e as { constructor: { name: string } }).constructor.name === 'NotFoundError');
});

test('goal() never throws, even with garbage input', () => {
  const { fetchLike } = capture();
  const errors: string[] = [];
  const c = client(fetchLike, { sendMode: 'background', onError: (e) => errors.push(e.code) });
  assert.doesNotThrow(() => c.goal(undefined as unknown as string, undefined as unknown as { reference: string }));
  assert.deepEqual(errors, ['invalid_goal_key']);
});

test('background mode: the timer flushes on its own', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: { object: 'list', data: [{ index: 0, ok: true, status: 201 }] } }]);
  const c = client(fetchLike, { sendMode: 'background', flushInterval: 20 });
  c.goal('order_paid', { reference: 'ORD-1' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /\/v1\/goals\/events\/batch$/);
  await c.close();
});

test('change 10: analytics and link lists take a metadata filter (metadata[<key>]=<value>)', async () => {
  const page = { object: 'list', data: [{ group: 'sel_ada', end_goal_value: { NGN: '18500.00' }, end_goal_value_minor: { NGN: 1850000 } }], has_more: false, next_cursor: null };
  const { calls, fetchLike } = capture([{ status: 200, json: page }, { status: 200, json: { object: 'list', data: [], has_more: false, next_cursor: null } }]);
  const c = client(fetchLike);
  const res = await c.api.analytics.analyticsSummary({ from: '2026-10-01T00:00:00Z', group_by: 'metadata.product_id', metadata: { seller_id: 'sel_ada' } });
  assert.equal(calls[0]!.url, 'https://api.clikgate.com/v1/analytics/summary?from=2026-10-01T00%3A00%3A00Z&group_by=metadata.product_id&metadata%5Bseller_id%5D=sel_ada');
  // end_goal_value is decimal strings per currency, next to end_goal_value_minor (X.E10).
  const row = res.data[0]!;
  const v: string | undefined = row.end_goal_value?.NGN;
  assert.equal(v, '18500.00');
  assert.equal(row.end_goal_value_minor?.NGN, 1850000);
  await c.api.links.listLinks({ metadata: { seller_id: 'sel ada' } });
  assert.equal(calls[1]!.url, 'https://api.clikgate.com/v1/links?metadata%5Bseller_id%5D=sel%20ada');
  await c.close();
});
