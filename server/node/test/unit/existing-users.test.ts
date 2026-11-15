import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ConflictError,
  InvalidRequestError,
  PrivateModeFieldRejectedError,
  canonicalCustomerId,
  createIdentityToken,
  customerIdWarning,
} from '../../src/index.js';
import { capture, client } from './helpers.js';

interface V2 { name: string; secret: string; customer_id: string; issued_at: number; customer_since: number; token: string }
const TOKENS = JSON.parse(readFileSync(new URL('../../../../conformance/vectors/identity-token-vectors.json', import.meta.url), 'utf8')) as {
  v2: V2[];
  v2_invalid_customer_since: Array<{ name: string; issued_at: number; customer_since: number }>;
  forgeries: Array<{ name: string; real_token: string; forged_token: string }>;
};
const IDS = JSON.parse(readFileSync(new URL('../../../../conformance/vectors/customer-id-vectors.json', import.meta.url), 'utf8')) as {
  vectors: Array<{ name: string; input: string; allow_11_digit_ids: boolean; canonical: string; warning: string | null }>;
};

test('version 2 identity tokens match the shared vectors', () => {
  assert.ok(TOKENS.v2.length >= 10);
  for (const v of TOKENS.v2) {
    assert.equal(createIdentityToken(v.customer_id, { secret: v.secret, issuedAt: v.issued_at, customerSince: v.customer_since }), v.token, v.name);
  }
  const ascii = TOKENS.v2.find((v) => v.name === 'v2_ascii')!;
  assert.equal(createIdentityToken('user_42', { secret: ascii.secret, issuedAt: ascii.issued_at, customerSince: new Date(ascii.customer_since * 1000 + 999) }), ascii.token);
});

test('account dates out of range are refused locally', () => {
  for (const bad of TOKENS.v2_invalid_customer_since) {
    assert.throws(
      () => createIdentityToken('user_42', { secret: 'cgis_unit', issuedAt: bad.issued_at, customerSince: bad.customer_since }),
      (e: unknown) => e instanceof InvalidRequestError && e.param === 'customer_since',
      bad.name,
    );
  }
});

test('forged tokens never equal the real version 2 token', () => {
  for (const f of TOKENS.forgeries) assert.notEqual(f.forged_token, f.real_token, f.name);
});

test('canonical customer IDs and warnings match the shared vectors', () => {
  for (const v of IDS.vectors) {
    assert.equal(canonicalCustomerId(v.input), v.canonical, v.name);
    assert.equal(customerIdWarning(v.input, { allow11DigitIds: v.allow_11_digit_ids }), v.warning, v.name);
  }
});

test('identifyUser sends customer_since and customer_since_replace', async () => {
  const { calls, fetchLike } = capture([
    { status: 200, json: { object: 'person_identified', person_id: 'per_1', label_ignored: null, customer_since_ignored: null, customer_id_warning: null } },
    { status: 200, json: { object: 'person_identified', person_id: 'per_1', label_ignored: null } },
    { status: 200, json: { object: 'person_identified', person_id: 'per_1', label_ignored: null } },
  ]);
  const c = client(fetchLike);
  await c.identifyUser({ customerId: 'u_1', customerSince: '2024-03-02' });
  await c.identifyUser({ customerId: 'u_1', customerSince: 1709370000, customerSinceReplace: true });
  await c.identifyUser({ customerId: 'u_1', customerSince: new Date('2024-03-02T09:00:00Z') });
  assert.deepEqual(JSON.parse(calls[0]!.body), { customer_id: 'u_1', customer_since: '2024-03-02' });
  assert.deepEqual(JSON.parse(calls[1]!.body), { customer_id: 'u_1', customer_since: '2024-03-02T09:00:00Z', customer_since_replace: true });
  assert.deepEqual(JSON.parse(calls[2]!.body), { customer_id: 'u_1', customer_since: '2024-03-02T09:00:00Z' });
  await assert.rejects(c.identifyUser({ appId: 'app_1', installationId: 'i', customerSince: '2024-03-02' }), (e: unknown) => e instanceof InvalidRequestError && e.param === 'customer_since');
  await assert.rejects(c.identifyUser({ customerId: 'u_1', customerSince: 'March 2024' }), (e: unknown) => e instanceof InvalidRequestError && e.param === 'customer_since');
  assert.equal(calls.length, 3);
});

test('private mode refuses customerSince and known customers locally', async () => {
  const { calls, fetchLike } = capture();
  const c = client(fetchLike, { privateMode: true });
  await assert.rejects(c.identifyUser({ appId: 'app_1', installationId: 'i', label: 'Ada', customerSince: '2024-03-02', customerId: 'u_1' }), (e: unknown) => e instanceof PrivateModeFieldRejectedError);
  await assert.rejects(c.knownCustomers.import([{ customerId: 'u_1' }]), (e: unknown) => e instanceof ConflictError && e.code === 'private_mode_conflict' && e.httpStatus === null);
  await assert.rejects(c.knownCustomers.remove('u_1'), (e: unknown) => e instanceof ConflictError && e.code === 'private_mode_conflict');
  assert.equal(calls.length, 0);
});

test('knownCustomers.import batches by 10,000 and sums the counts', async () => {
  const answer = (accepted: number, refused: number, reasons: Record<string, number>) => ({ status: 200, json: { accepted, refused, refused_by_reason: reasons } });
  const { calls, fetchLike } = capture([answer(9_990, 10, { looks_like_phone: 10 }), answer(9_998, 2, { looks_like_phone: 1, bad_date: 1 }), answer(5, 0, {})]);
  const c = client(fetchLike);
  const rows = Array.from({ length: 20_005 }, (_, i) => ({ customerId: `u_${i}`, customerSince: i === 0 ? new Date('2024-03-02T23:30:00Z') : i === 1 ? 1709337600 : null }));
  const result = await c.knownCustomers.import(rows, { idempotencyKey: 'imp-1' });
  assert.deepEqual(result, { accepted: 19_993, refused: 12, refused_by_reason: { looks_like_phone: 11, bad_date: 1 } });
  assert.equal(calls.length, 3);
  const first = JSON.parse(calls[0]!.body) as { customers: Array<Record<string, string>> };
  assert.equal(first.customers.length, 10_000);
  assert.deepEqual(first.customers[0], { customer_id: 'u_0', customer_since: '2024-03-02' });
  assert.deepEqual(first.customers[1], { customer_id: 'u_1', customer_since: '2024-03-02' });
  assert.deepEqual(first.customers[2], { customer_id: 'u_2' });
  assert.equal((JSON.parse(calls[2]!.body) as { customers: unknown[] }).customers.length, 5);
  assert.deepEqual(calls.map((x) => x.headers['idempotency-key']), ['imp-1-0', 'imp-1-1', 'imp-1-2']);
  assert.ok(calls.every((x) => x.url.endsWith('/v1/known-customers/import') && x.method === 'POST'));
  assert.deepEqual(await c.knownCustomers.import([]), { accepted: 0, refused: 0, refused_by_reason: {} });
  await assert.rejects(c.knownCustomers.import([{ customerId: 'u', customerSince: '02/03/2024' }]), (e: unknown) => e instanceof InvalidRequestError && e.param === 'customer_since');
});

test('knownCustomers.remove sends the ID in the body', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: { removed: true } }]);
  const c = client(fetchLike);
  assert.deepEqual(await c.knownCustomers.remove('u_10482'), { removed: true });
  assert.ok(calls[0]!.url.endsWith('/v1/known-customers/remove'));
  assert.ok(!calls[0]!.url.includes('u_10482'));
  assert.deepEqual(JSON.parse(calls[0]!.body), { customer_id: 'u_10482' });
});
