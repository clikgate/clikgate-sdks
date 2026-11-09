import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Clikgate, ClikgateError, ClikgateServerOnlyError, ConfigurationError, InvalidRequestError, createIdentityToken } from '../../src/index.js';
import { isBrowserOrMobile } from '../../src/identity.js';

interface Vector { name: string; secret: string; customer_id: string; issued_at: number; token: string }
const VECTORS = JSON.parse(readFileSync(new URL('../../../../conformance/vectors/identity-token-vectors.json', import.meta.url), 'utf8')) as {
  vectors: Vector[];
  invalid_customer_ids: Array<{ name: string; customer_id: string }>;
};

const ENV = ['CLIKGATE_IDENTITY_SECRET', 'CLIKGATE_IDENTITY_SECRETS'] as const;
function withEnv(values: Partial<Record<(typeof ENV)[number], string>>, fn: () => void): void {
  const saved = ENV.map((k) => [k, process.env[k]] as const);
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('identity tokens match the shared vectors (made by the backend signer)', () => {
  assert.ok(VECTORS.vectors.length >= 10);
  for (const v of VECTORS.vectors) {
    assert.equal(createIdentityToken(v.customer_id, { secret: v.secret, issuedAt: v.issued_at }), v.token, v.name);
  }
});

test('the secret comes from CLIKGATE_IDENTITY_SECRET, or the app from CLIKGATE_IDENTITY_SECRETS', () => {
  const [a, other] = [VECTORS.vectors.find((v) => v.name === 'ascii')!, VECTORS.vectors.find((v) => v.name === 'other_app_secret')!];
  withEnv({ CLIKGATE_IDENTITY_SECRET: a.secret }, () => {
    assert.equal(createIdentityToken(a.customer_id, { issuedAt: a.issued_at }), a.token);
    assert.equal(createIdentityToken(a.customer_id, { appId: 'app_unknown', issuedAt: a.issued_at }), a.token); // falls back to the single secret
  });
  withEnv({ CLIKGATE_IDENTITY_SECRETS: JSON.stringify({ app_shop: a.secret, app_rider: other.secret }) }, () => {
    assert.equal(createIdentityToken('user_42', { appId: 'app_rider', issuedAt: other.issued_at }), other.token);
    assert.equal(createIdentityToken('user_42', { appId: 'app_shop', issuedAt: a.issued_at }), a.token);
    assert.throws(() => createIdentityToken('user_42'), (e: unknown) => e instanceof ConfigurationError && e.code === 'missing_identity_secret' && e.param === 'appId');
  });
  withEnv({}, () => {
    assert.throws(() => createIdentityToken('user_42'), (e: unknown) => e instanceof ConfigurationError && e.code === 'missing_identity_secret');
  });
  withEnv({ CLIKGATE_IDENTITY_SECRETS: '{not json' }, () => {
    assert.throws(
      () => createIdentityToken('user_42', { appId: 'app_shop' }),
      (e: unknown) => e instanceof ConfigurationError && e.code === 'invalid_identity_secrets' && !e.message.includes('not json'),
    );
  });
});

test('the client method uses identitySecret / identitySecrets from its options', () => {
  const [a, other] = [VECTORS.vectors.find((v) => v.name === 'ascii')!, VECTORS.vectors.find((v) => v.name === 'other_app_secret')!];
  withEnv({}, () => {
    const c = new Clikgate({ apiKey: 'cg_test_unit000000', shutdownHooks: false, identitySecret: a.secret, identitySecrets: { app_rider: other.secret } });
    assert.equal(c.createIdentityToken('user_42', { issuedAt: a.issued_at }), a.token);
    assert.equal(c.createIdentityToken('user_42', { appId: 'app_rider', issuedAt: other.issued_at }), other.token);
  });
});

test('issuedAt defaults to now in whole seconds', () => {
  const before = Math.floor(Date.now() / 1000);
  const token = createIdentityToken('user_42', { secret: 'cgis_unit' });
  const issued = Number(token.split('.').pop());
  assert.ok(issued >= before && issued <= before + 2);
  assert.match(token, /^[A-Za-z0-9_-]{43}\.\d+$/);
});

test('invalid customer IDs are refused without echoing them', () => {
  for (const bad of VECTORS.invalid_customer_ids) {
    assert.throws(
      () => createIdentityToken(bad.customer_id, { secret: 'cgis_unit', issuedAt: 1 }),
      (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_customer_id' && (bad.customer_id === '' || !e.message.includes(bad.customer_id)),
      bad.name,
    );
  }
  assert.throws(() => createIdentityToken(42 as unknown as string, { secret: 'cgis_unit' }), InvalidRequestError);
});

test('refuses browser and React Native builds (ClikgateServerOnlyError)', () => {
  assert.equal(isBrowserOrMobile({}), false);
  assert.equal(isBrowserOrMobile({ window: {} }), true);
  assert.equal(isBrowserOrMobile({ document: {} }), true);
  assert.equal(isBrowserOrMobile({ navigator: { product: 'ReactNative' } }), true);
  assert.equal(isBrowserOrMobile({ navigator: { userAgent: 'Node.js/22' } }), false);
  const g = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of [['window', {}], ['document', {}]] as const) {
    g[key] = value;
    try {
      assert.throws(
        () => createIdentityToken('user_42', { secret: 'cgis_unit' }),
        (e: unknown) => e instanceof ClikgateServerOnlyError && e instanceof ClikgateError && e.code === 'server_only' && !e.message.includes('cgis_unit'),
      );
    } finally {
      delete g[key];
    }
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { product: 'ReactNative' }, configurable: true, writable: true });
  try {
    assert.throws(() => createIdentityToken('user_42', { secret: 'cgis_unit' }), ClikgateServerOnlyError);
  } finally {
    if (nav) Object.defineProperty(globalThis, 'navigator', nav);
    else delete g.navigator;
  }
});
