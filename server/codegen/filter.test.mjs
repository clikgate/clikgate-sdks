// Change 21 (R.41): the server SDK generator uses only `public` routes. Run: node --test server/codegen/filter.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { declaresAudiences, filterSpec, neverPublishedOperations } from './filter.mjs';
import { backendSpec, vendoredSpec } from './source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AUDIENCES = ['public', 'sdk', 'dashboard', 'partner', 'webhook', 'staff', 'internal'];
// Webhook *management* routes (`/v1/webhooks/...`) are public; webhook *receivers* are excluded by audience
const FORBIDDEN = /^\/v1\/staff(\/|$)|^\/internal(\/|$)|^\/v1\/sdk(\/|$)/;

const op = (audience, summary, auth = 'api_key') => ({
  summary,
  tags: ['Links'],
  ...(audience ? { 'x-audience': audience } : {}),
  'x-clikgate-auth': auth,
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } } },
});

/** Every audience on its own path, all marked `api_key` (the worst case: auth alone would let them all through). */
function audienceSpec() {
  const paths = {
    '/v1/links': { get: op('public', 'List links') },
    '/v1/sdk/open': { post: op('sdk', 'Sdk open') },
    '/v1/sdk/resolve': { post: op('sdk', 'Sdk resolve') },
    '/v1/web/goals': { post: op('sdk', 'Web goal') },
    '/v1/members/me': { get: op('dashboard', 'Me') },
    '/v1/partner/earnings': { get: op('partner', 'Earnings') },
    '/v1/billing/paystack/webhook': { post: op('webhook', 'Paystack webhook') },
    '/v1/inbound/whatsapp': { post: op('webhook', 'WhatsApp inbound') },
    '/v1/staff/organizations': { get: op('staff', 'Staff orgs') },
    '/internal/reconcile': { post: op('internal', 'Reconcile') },
    '/v1/undeclared': { get: op(undefined, 'Undeclared') },
  };
  return { openapi: '3.1.0', info: { title: 't', version: '1' }, paths, components: { schemas: { Thing: { type: 'object' } } } };
}

const kept = (spec) => Object.entries(spec.paths).flatMap(([path, item]) => Object.values(item).map((o) => ({ path, o })));

test('with audiences, only x-audience public operations are generated', () => {
  const source = audienceSpec();
  assert.equal(declaresAudiences(source), true);
  const { spec, report } = filterSpec(source);
  assert.deepEqual(Object.keys(spec.paths), ['/v1/links']);
  assert.equal(report.included, 1);
  assert.equal(report.audiences, true);
  assert.ok(report.skipped.some((s) => s.startsWith('GET /v1/undeclared') && s.includes('"missing"')), 'undeclared is hidden');
});

test('never emits sdk, staff, internal or webhook routes, for every audience', () => {
  for (const audience of AUDIENCES) {
    const source = { ...audienceSpec(), paths: { '/v1/thing': { post: op(audience, `Thing ${audience}`) } } };
    const { spec } = filterSpec(source);
    assert.equal(Object.keys(spec.paths).length, audience === 'public' ? 1 : 0, audience);
  }
  const { spec } = filterSpec(audienceSpec());
  for (const { path } of kept(spec)) assert.doesNotMatch(path, FORBIDDEN);
  for (const receiver of ['/v1/billing/paystack/webhook', '/v1/inbound/whatsapp', '/v1/web/goals']) assert.ok(!spec.paths[receiver], receiver);
});

test('staff, internal and SDK protocol paths are never generated, even if mislabelled public', () => {
  const source = {
    ...audienceSpec(),
    paths: {
      '/v1/staff/x': { get: op('public', 'A') },
      '/internal/y': { get: op('public', 'B') },
      '/v1/sdk/install': { post: op('public', 'C') },
      '/v1/links': { get: op('public', 'D') },
    },
  };
  assert.deepEqual(Object.keys(filterSpec(source).spec.paths), ['/v1/links']);
});

test('the generator input check names staff, internal and webhook audiences', () => {
  const found = neverPublishedOperations(audienceSpec());
  assert.deepEqual(found.sort(), [
    'GET /v1/staff/organizations (x-audience staff)',
    'POST /internal/reconcile (x-audience internal)',
    'POST /v1/billing/paystack/webhook (x-audience webhook)',
    'POST /v1/inbound/whatsapp (x-audience webhook)',
  ]);
  const publicOnly = { ...audienceSpec(), paths: { '/v1/links': audienceSpec().paths['/v1/links'], '/v1/sdk/open': audienceSpec().paths['/v1/sdk/open'] } };
  assert.deepEqual(neverPublishedOperations(publicOnly), []);
});

test('fallback: a document without audiences is filtered by x-clikgate-auth as before', () => {
  const source = {
    ...audienceSpec(),
    paths: {
      '/v1/links': { get: op(undefined, 'List links') },
      '/v1/sdk/open': { post: op(undefined, 'Open', 'sdk_key') },
      '/v1/members/me': { get: op(undefined, 'Me', 'dashboard_session') },
      '/v1/billing/paystack/webhook': { post: op(undefined, 'Hook', 'public') },
    },
  };
  assert.equal(declaresAudiences(source), false);
  assert.deepEqual(Object.keys(filterSpec(source).spec.paths), ['/v1/links']);
});

test('the vendored spec yields no sdk, staff, internal or webhook routes', () => {
  const { path } = vendoredSpec(join(here, '..', 'openapi'));
  const { spec } = filterSpec(JSON.parse(readFileSync(path, 'utf8')));
  assert.ok(kept(spec).length > 0);
  for (const { path: p, o } of kept(spec)) {
    assert.doesNotMatch(p, FORBIDDEN, p);
    assert.ok(!o['x-audience'] || o['x-audience'] === 'public');
  }
});

test('the backend public document is preferred, with a fallback to the legacy one', () => {
  const has = (...files) => (p) => files.some((f) => p.endsWith(f));
  assert.deepEqual(backendSpec('/b', has('docs/openapi-public.json', 'docs/openapi.json')), {
    path: join('/b', 'docs', 'openapi-public.json'),
    name: 'openapi-public.json',
    fallback: false,
  });
  assert.deepEqual(backendSpec('/b', has('docs/openapi.json')), { path: join('/b', 'docs', 'openapi.json'), name: 'openapi.json', fallback: true });
  assert.equal(vendoredSpec('/v', has('/v/openapi-public.json')).name, 'openapi-public.json');
  assert.equal(vendoredSpec('/v', has('/v/openapi.json')).name, 'openapi.json');
  // Never the private documents
  for (const s of [backendSpec('/b', () => true), vendoredSpec('/v', () => true)]) assert.doesNotMatch(s.path, /staff|dashboard/);
});
