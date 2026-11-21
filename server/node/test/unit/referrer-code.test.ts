import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError } from '../../src/index.js';
import { capture, client } from './helpers.js';

const referrer = { object: 'referrer', id: 'rfr_1', customer_user_id: 'user-42', code: 'ADA2026', external_code: 'ada-old' };

test('getOrCreateReferrer sends code and external_code as given', async () => {
  const { calls, fetchLike } = capture([{ status: 201, json: referrer }]);
  const r = await client(fetchLike).referrals.getOrCreateReferrer('rpg_1', { customerId: 'user-42', displayName: 'Ada', code: 'ADA2026', externalCode: 'ada-old' });
  assert.equal(calls[0]?.url, 'https://api.clikgate.com/v1/referral-programs/rpg_1/referrers');
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ''), { customer_user_id: 'user-42', display_name: 'Ada', code: 'ADA2026', external_code: 'ada-old' });
  assert.equal(r.code, 'ADA2026');
  assert.equal(r.created, true);
});

test('getOrCreateReferrer omits code when not given', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: referrer }]);
  await client(fetchLike).referrals.getOrCreateReferrer('rpg_1', { customerId: 'user-42' });
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ''), { customer_user_id: 'user-42' });
});

test('a code already used in the organisation is a ConflictError with code_taken', async () => {
  const { fetchLike } = capture([{ status: 409, json: { error: { type: 'conflict', code: 'code_taken', message: 'Another referrer or link in this organisation has this code.', param: 'code' } } }]);
  await assert.rejects(client(fetchLike, { maxRetries: 0 }).referrals.getOrCreateReferrer('rpg_1', { customerId: 'user-42', code: 'ADA2026' }), (e: unknown) => {
    assert.ok(e instanceof ConflictError);
    assert.equal(e.code, 'code_taken');
    assert.equal(e.param, 'code');
    assert.equal(e.httpStatus, 409);
    return true;
  });
});

test('updateReferrer sends external_code, and null removes it', async () => {
  const { calls, fetchLike } = capture([{ status: 200, json: referrer }, { status: 200, json: referrer }]);
  const c = client(fetchLike);
  await c.referrals.updateReferrer('rfr_1', { externalCode: 'ADA-NEW' });
  await c.referrals.updateReferrer('rfr_1', { externalCode: null });
  assert.deepEqual(JSON.parse(calls[0]?.body ?? ''), { external_code: 'ADA-NEW' });
  assert.deepEqual(JSON.parse(calls[1]?.body ?? ''), { external_code: null });
});
