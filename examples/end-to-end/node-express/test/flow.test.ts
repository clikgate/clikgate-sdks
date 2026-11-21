import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';
import type { RewardStore } from '../src/rewards.ts';
import { FakeClikgate } from './fake-clikgate.ts';

const WEBHOOK_SECRET = 'whsec_test_sample_only';
const INSTALLATION = 'app_01JAB3C4D5E6F7G8H9JKMNPQRS:6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11';

const clikgateApi = new FakeClikgate();
let server: Server;
let baseUrl: string;
let rewards: RewardStore;
let flushGoals: () => Promise<boolean>;

before(async () => {
  const built = createApp({
    apiKey: 'cg_test_sample_only',
    baseUrl: await clikgateApi.start(),
    identitySecret: 'test-identity-secret-sample-only',
    webhookSecret: WEBHOOK_SECRET,
    referralProgramId: 'rpg_test_sample',
    port: 0,
  });
  rewards = built.rewards;
  flushGoals = () => built.clikgate.flush();
  server = built.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await clikgateApi.stop();
});

test('sign-up, sign-in, /me, payment, referral code and rewards against a fake Clikgate', async () => {
  // 1. Sign-up: the token carries the account date, and Path B identifies the installation from the header.
  const signUp = await call('POST', '/auth/sign-up', { email: 'ada@example.com', password: 'correct horse' });
  assert.equal(signUp.status, 201);
  const session = await signUp.json();
  const userId: string = session.user.id;
  const createdAt = Math.floor(Date.parse(session.user.createdAt) / 1000);
  assertTokenHasAccountDate(session.clikgateIdentityToken, createdAt);

  const identify = clikgateApi.requestsTo('/v1/people/identify')[0]!.body;
  assert.equal(identify.installation_id, '6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11');
  assert.equal(identify.app_id, 'app_01JAB3C4D5E6F7G8H9JKMNPQRS');
  assert.equal(identify.customer_id, userId);
  assert.ok(identify.customer_since);

  // 2. Sign-in: wrong password refused, right password gets a fresh token.
  assert.equal((await call('POST', '/auth/sign-in', { email: 'ada@example.com', password: 'nope' })).status, 401);
  const signIn = await call('POST', '/auth/sign-in', { email: 'ada@example.com', password: 'correct horse' });
  assertTokenHasAccountDate((await signIn.json()).clikgateIdentityToken, createdAt);

  // 3. /me needs the session, and returns a token too.
  assert.equal((await call('GET', '/me')).status, 401);
  assertTokenHasAccountDate((await (await call('GET', '/me', undefined, session.accessToken)).json()).clikgateIdentityToken, createdAt);

  // 4. The server goal from sign-up was queued; flushing sends it.
  assert.equal(await flushGoals(), true);
  assert.ok(clikgateApi.requests.some((r) => r.path.startsWith('/v1/goals/events') && JSON.stringify(r.body).includes('account_opened') && JSON.stringify(r.body).includes(userId)));

  // 5. Payment: confirmed from the (stubbed) gateway's answer, in normal units.
  assert.equal((await call('POST', '/payments/paystack/confirm', { reference: 'T123456' }, session.accessToken)).status, 200);
  const confirmation = clikgateApi.requestsTo('/v1/payments/confirmations')[0]!.body;
  assert.deepEqual([confirmation.provider, confirmation.reference, confirmation.amount, confirmation.currency, confirmation.goal], ['paystack', 'T123456', '7500', 'NGN', 'order_paid']);

  // 6. Referral code: the same code on every call.
  const first = await (await call('GET', '/me/referral', undefined, session.accessToken)).json();
  const second = await (await call('GET', '/me/referral', undefined, session.accessToken)).json();
  assert.ok(first.code);
  assert.equal(first.code, second.code);
  assert.match(first.link, /^https:\/\//);
  assert.equal(clikgateApi.requestsTo('/v1/referral-programs/rpg_test_sample/referrers')[0]!.body.customer_user_id, userId);

  // Every call to the API used the server key.
  assert.ok(clikgateApi.requests.every((r) => r.authorization === 'Bearer cg_test_sample_only'));

  // 7. Webhooks: verified, deduplicated, and the reward is paid once.
  assert.equal(await webhook('evt_1', 'referral.qualified', 'ref_1', userId, WEBHOOK_SECRET), 200);
  assert.equal(await webhook('evt_1', 'referral.qualified', 'ref_1', userId, WEBHOOK_SECRET), 200); // redelivery
  assert.equal(await webhook('evt_2', 'referral.qualified', 'ref_1', userId, WEBHOOK_SECRET), 200); // same referral
  assert.equal(rewards.paidCount(), 1);
  assert.equal(rewards.find('ref_1')?.referrerUserId, userId);

  assert.equal(await webhook('evt_3', 'referral.disqualified', 'ref_2', userId, WEBHOOK_SECRET), 200);
  assert.equal(rewards.find('ref_2')?.status, 'disqualified');
  assert.equal(await webhook('evt_4', 'referral.qualified', 'ref_3', userId, 'whsec_wrong'), 400);
  assert.equal(rewards.find('ref_3'), undefined);
  assert.equal(rewards.paidCount(), 1);
});

/** A version 2 token ends with the account date in Unix seconds: <signature>.<issued at>.<customer since> */
function assertTokenHasAccountDate(token: string, createdAtSeconds: number): void {
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  assert.equal(parts[2], String(createdAtSeconds));
}

function call(method: string, path: string, body?: object, accessToken?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Clikgate-Installation': INSTALLATION };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function webhook(eventId: string, type: string, referralId: string, referrerUserId: string, secret: string): Promise<number> {
  const referral = { id: referralId, referrer: { customer_user_id: referrerUserId }, referee: { customer_user_id: 'user_friend' } };
  const body = JSON.stringify({ id: eventId, type, data: { object: referral } });
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const res = await fetch(`${baseUrl}/webhooks/clikgate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Clikgate-Signature': `t=${t},v1=${signature}` },
    body,
  });
  return res.status;
}
