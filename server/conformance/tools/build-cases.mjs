#!/usr/bin/env node
// Authoring source for the conformance cases. Writes ../cases/*.json (the language-neutral artefact
// every runner reads). Hashes and webhook signatures are computed here so they are always right.
//
//   node server/conformance/tools/build-cases.mjs          # write the JSON files
//   node server/conformance/tools/build-cases.mjs --check  # fail if the JSON files are out of date
//
// Edit this file, run it, commit both. See ../README.md for the case format.

import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'cases');
const check = process.argv.includes('--check');

const NOW_MS = 1_793_016_000_000; // 2026-10-26T12:00:00Z
const NOW_S = NOW_MS / 1000;
const KEY = 'cg_test_conformance0000000000';
const LIVE_KEY = 'cg_live_conformance0000000000';

const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';
const CLICK2 = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W7';
const LINK = 'lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA';

// Change 12 (backend C12 B2.3): `status` is the GoalStatus (counted | waiting | refused); the conversion state that
// was in `status` is `event_status`; plus goal_kind, value_ignored and payment.
const goalEvent = (over = {}) => ({
  object: 'goal_event',
  id: 'cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE',
  status: 'counted',
  reason: null,
  goal_kind: 'standard',
  counted: true,
  value_ignored: false,
  event_status: 'attributed',
  goal: 'account_opened',
  reference: 'APP-55231',
  value: '2000000',
  currency: 'NGN',
  reversed_value: null,
  first_for_click: true,
  is_first: true,
  unattributed_reason: null,
  duplicate_of_id: null,
  attributed_to: { link_id: LINK, campaign_id: 'cmp_01JCK8Z9V7Q4M2N6P8R0S2T4CP', clicked_at: '2026-10-22T18:01:12Z' },
  occurred_at: '2026-10-23T09:12:00Z',
  received_at: '2026-10-23T09:12:01Z',
  livemode: false,
  payment: null,
  ...over,
});
const link = (over = {}) => ({
  object: 'link',
  id: LINK,
  short_url: 'https://dev.ciz.to/spring',
  domain: 'dev.ciz.to',
  slug: 'spring',
  status: 'active',
  destination_url: 'https://example.com/spring',
  fallback_url: null,
  title: 'Spring sale',
  og_title: null,
  og_image_url: null,
  tags: [],
  metadata: {},
  warnings: [],
  created_at: '2026-10-26T11:00:00Z',
  updated_at: '2026-10-26T11:00:00Z',
  livemode: false,
  ...over,
});
const NO_PREVIEW = { code: 'no_preview', message: 'Add a preview title and image. In WhatsApp and social apps, people look at the preview more than the link.', param: null };
const changeRequest = {
  object: 'link_change_request',
  id: 'lcr_01JCK8Z9V7Q4M2N6P8R0S2T4CR',
  link_id: LINK,
  status: 'pending',
  from_url: 'https://example.com/spring',
  to_url: 'https://example.com/summer',
  requested_by: 'key_01JCK8Z9V7Q4M2N6P8R0S2T4KY',
  requested_by_type: 'api_key',
  decided_by: null,
  decided_at: null,
  decision_note: null,
  expires_at: '2026-11-02T12:00:00Z',
  created_at: '2026-10-26T12:00:00Z',
  livemode: false,
}; // backend LinkChangeRequestInfoResponse (C6-B5)
const click = {
  object: 'click',
  id: CLICK,
  pending: false,
  occurred_at: '2026-10-22T18:01:12Z',
  link: { id: LINK },
  campaign: null,
  country: 'NG',
  device_type: 'mobile',
  is_suspected_bot: false,
  livemode: false,
};
const config = (over = {}) => ({
  mode: 'test',
  organization_id: 'org_01JCK8Z9V7Q4M2N6P8R0S2T4OR',
  private_mode: false,
  click_id_param: 'cgid',
  goals: [
    { key: 'account_opened', value_mode: 'optional', default_currency: 'NGN' },
    { key: 'signup', value_mode: 'none', default_currency: 'NGN' },
    { key: 'loan_disbursed', value_mode: 'required', default_currency: 'NGN' },
    { key: 'order_paid', value_mode: 'optional', default_currency: 'NGN' },
  ],
  minimum_sdk_versions: { node: '1.0.0', python: '1.0.0', php: '1.0.0', java: '1.0.0', dotnet: '1.0.0' },
  ...over,
});
const err = (status, type, code, message, param = null, request_id = 'req_01JCK8Z9V7Q4M2N6P8R0S2T4RQ', extra = {}) => ({
  status,
  headers: { 'x-request-id': request_id || 'req_header' },
  json: { error: { type, code, message, param, request_id, ...extra } },
});
const ok = (json, status = 200, headers = {}) => ({ status, json, headers: { 'x-request-id': 'req_ok', ...headers } });

const GOAL_POST = { method: 'POST', path: '/v1/goals/events' };
const BATCH_POST = { method: 'POST', path: '/v1/goals/events/batch' };
const CONFIG_GET = { method: 'GET', path: '/v1/server-sdk/config', query: {} };

const files = {};
const add = (suite, description, list) => {
  files[suite] = { suite, description, cases: list };
};

// ---------------------------------------------------------------------------------------------
add('client', 'Construction, configuration errors, default headers, paths and request IDs (SPEC 3, 4, 5)', [
  {
    id: 'client.headers.get',
    description: 'A GET carries Authorization, User-Agent and Accept, and no Idempotency-Key or Content-Type',
    responses: [ok(click)],
    steps: [{ call: 'clicks.get', args: { id: CLICK }, expect: { result: { id: CLICK, object: 'click' } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/clicks/${CLICK}`, query: {}, absent_headers: ['idempotency-key', 'content-type'], no_body: true }] },
  },
  {
    id: 'client.base_url.trailing_slash',
    description: 'A trailing slash on base_url is removed',
    base_url_suffix: '/',
    responses: [ok(click)],
    steps: [{ call: 'clicks.get', args: { id: CLICK } }],
    expect: { requests: [{ method: 'GET', path: `/v1/clicks/${CLICK}` }] },
  },
  {
    id: 'client.mode.test',
    description: 'The mode comes from the key prefix: cg_test_ is test',
    steps: [{ call: 'client.mode', expect: { result: { value: 'test' } } }],
    expect: { requests: [] },
  },
  {
    id: 'client.mode.live',
    description: 'The mode comes from the key prefix: cg_live_ is live',
    client: { api_key: LIVE_KEY },
    steps: [{ call: 'client.mode', expect: { result: { value: 'live' } } }],
    expect: { requests: [] },
  },
  {
    id: 'client.config_error.missing_api_key',
    description: 'No api_key and no CLIKGATE_API_KEY: ConfigurationError at construction',
    client: { api_key: null },
    steps: [],
    expect: { construct_error: { class: 'ConfigurationError', code: 'missing_api_key', http_status: null }, requests: [] },
  },
  ...[
    ['mobile_sdk_key', 'cg_sdk_live_abc123'],
    ['site_key', 'cg_site_live_abc123'],
    ['cli_token', 'cg_cli_abc123'],
    ['foreign_key', 'sk_live_abc123'],
  ].map(([name, k]) => ({
    id: `client.config_error.${name}`,
    description: `A ${name.replace(/_/g, ' ')} is not a server API key: ConfigurationError, and the message never contains the key`,
    client: { api_key: k },
    steps: [],
    expect: { construct_error: { class: 'ConfigurationError', code: 'invalid_api_key', message_excludes: [k] }, requests: [] },
  })),
  {
    id: 'client.config_error.insecure_base_url',
    description: 'http:// is refused except for localhost, 127.0.0.1 and [::1]',
    client: { base_url: 'http://api.example.com' },
    steps: [],
    expect: { construct_error: { class: 'ConfigurationError', code: 'invalid_option' }, requests: [] },
  },
  {
    id: 'client.config_error.max_retries',
    description: 'max_retries must be 0-10',
    client: { max_retries: 11 },
    steps: [],
    expect: { construct_error: { class: 'ConfigurationError', code: 'invalid_option' }, requests: [] },
  },
  {
    id: 'client.config_error.click_id_param',
    description: 'click_id_param must match ^[A-Za-z0-9_]{1,32}$',
    client: { click_id_param: 'bad-param!' },
    steps: [],
    expect: { construct_error: { class: 'ConfigurationError', code: 'invalid_option' }, requests: [] },
  },
  {
    id: 'client.path.encoding',
    description: 'Path parameters are percent-encoded',
    responses: [ok(link())],
    steps: [{ call: 'links.get', args: { id: 'lnk_a/b c' } }],
    expect: { requests: [{ method: 'GET', path: '/v1/links/lnk_a%2Fb%20c' }] },
  },
  {
    id: 'client.request_id.from_header',
    description: 'request_id falls back to the X-Request-Id header when the body has none',
    client: { max_retries: 0 },
    responses: [{ status: 404, headers: { 'x-request-id': 'req_from_header' }, json: { error: { type: 'not_found', code: 'resource_missing', message: 'No such click.', param: 'click_id', request_id: null } } }],
    steps: [{ call: 'clicks.get', args: { id: CLICK }, expect: { error: { class: 'NotFoundError', request_id: 'req_from_header', http_status: 404 } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/clicks/${CLICK}` }] },
  },
  {
    id: 'client.idempotency_key.override',
    description: 'An explicit idempotency_key request option is sent as given',
    responses: [ok(link(), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: 'https://example.com/spring' }, idempotency_key: 'my-own-key-1' } }],
    expect: { requests: [{ method: 'POST', path: '/v1/links', headers: { 'idempotency-key': 'my-own-key-1' }, json: { destination_url: 'https://example.com/spring' } }] },
  },
  {
    id: 'client.empty_id',
    description: 'An empty id is refused locally with invalid_argument',
    steps: [{ call: 'links.get', args: { id: '' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_argument', http_status: null } } }],
    expect: { requests: [] },
  },
]);

// ---------------------------------------------------------------------------------------------
const errCase = (id, description, response, expectError, { call = 'clicks.get', args = { id: CLICK }, max_retries = 0, requests = 1 } = {}) => ({
  id: `errors.${id}`,
  description,
  client: { max_retries },
  responses: Array.from({ length: requests }, () => response),
  steps: [{ call, args, expect: { error: expectError } }],
  expect: { requests: Array.from({ length: requests }, () => ({})) },
});
add('errors', 'Error envelope → typed errors (SPEC 5)', [
  errCase('400', '400 → InvalidRequestError', err(400, 'invalid_request', 'bad_request', 'Bad request.', 'limit'), { class: 'InvalidRequestError', code: 'bad_request', http_status: 400, param: 'limit', type: 'invalid_request', request_id: 'req_01JCK8Z9V7Q4M2N6P8R0S2T4RQ' }),
  errCase('401', '401 → AuthenticationError', err(401, 'authentication', 'invalid_credentials', 'Invalid credentials.'), { class: 'AuthenticationError', code: 'invalid_credentials', http_status: 401 }),
  errCase('403', '403 → PermissionError (extra envelope keys are kept in raw)', err(403, 'permission', 'plan_upgrade_required', 'Upgrade to use this.', null, 'req_1', { required_plan: 'growth' }), { class: 'PermissionError', code: 'plan_upgrade_required', http_status: 403 }),
  errCase('404', '404 → NotFoundError with param and request_id', err(404, 'not_found', 'resource_missing', 'No such click.', 'click_id', 'req_404'), { class: 'NotFoundError', code: 'resource_missing', param: 'click_id', request_id: 'req_404' }),
  errCase('409.conflict', '409 → ConflictError', err(409, 'conflict', 'slug_conflict', 'That slug is taken.', 'slug'), { class: 'ConflictError', code: 'slug_conflict', http_status: 409 }, { call: 'links.create', args: { params: { destination_url: 'https://example.com', slug: 'spring' } } }),
  errCase('409.link_locked', '409 link_locked → LinkLockedError (a ConflictError), never retried', err(409, 'conflict', 'link_locked', 'This link is locked.', 'destination_url'), { class: 'LinkLockedError', code: 'link_locked', http_status: 409 }, { call: 'links.update', args: { id: LINK, params: { destination_url: 'https://example.com/new' } }, max_retries: 3 }),
  errCase('409.idempotency_reused', '409 type idempotency → IdempotencyError', err(409, 'idempotency', 'idempotency_key_reused', 'This Idempotency-Key was already used with a different request.'), { class: 'IdempotencyError', code: 'idempotency_key_reused' }, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-55231', value: '2000000' }, max_retries: 3 }),
  errCase('409.idempotency_in_progress', '409 idempotency_request_in_progress is not retried', err(409, 'idempotency', 'idempotency_request_in_progress', 'A request with this Idempotency-Key is still being processed.'), { class: 'IdempotencyError', code: 'idempotency_request_in_progress' }, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-55231' }, max_retries: 3 }),
  errCase('410.goal_archived', '410 goal_archived → InvalidRequestError', err(410, 'invalid_request', 'goal_archived', 'This goal is archived and no longer accepts events.', 'goal'), { class: 'InvalidRequestError', code: 'goal_archived', http_status: 410, param: 'goal' }, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1' }, max_retries: 3 }),
  errCase('422.invalid_value', '422 → InvalidRequestError with param', err(422, 'invalid_request', 'invalid_value', 'Too many decimal places for NGN.', 'value'), { class: 'InvalidRequestError', code: 'invalid_value', http_status: 422, param: 'value' }, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', value: '1.005' }, max_retries: 3 }),
  errCase('422.private_mode_field_rejected', 'The server-side private-mode refusal → PrivateModeFieldRejectedError with field', err(422, 'invalid_request', 'private_mode_field_rejected', 'Private mode is on: metadata is not accepted.', 'metadata'), { class: 'PrivateModeFieldRejectedError', code: 'private_mode_field_rejected', field: 'metadata', param: 'metadata', http_status: 422 }, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { plan: 'gold' } }, max_retries: 3 }),
  errCase('429', '429 → RateLimitError with retry_after (no retries left)', { ...err(429, 'rate_limited', 'rate_limit_exceeded', 'Too many requests. Retry later.'), headers: { 'retry-after': '7', 'x-request-id': 'req_429' } }, { class: 'RateLimitError', code: 'rate_limit_exceeded', retry_after: 7, http_status: 429 }),
  errCase('500', '500 → ServerError', err(500, 'server', 'internal_error', 'Something went wrong.'), { class: 'ServerError', code: 'internal_error', http_status: 500 }),
  errCase('502.html', 'A non-JSON 502 → ServerError code http_502', { status: 502, headers: { 'content-type': 'text/html' }, body_text: '<html><body>Bad gateway</body></html>' }, { class: 'ServerError', code: 'http_502', http_status: 502, message: { $regex: '^HTTP 502' }, request_id: null }),
  errCase('501.not_retried', '501 is not retryable', err(501, 'server', 'not_implemented', 'Not implemented.'), { class: 'ServerError', code: 'not_implemented', http_status: 501 }, { max_retries: 3 }),
  // Only 429, 500, 502, 503 and 504 are retried (SPEC 6): every other 5xx is a ServerError at once.
  ...[505, 507, 508, 511, 599].map((status) =>
    errCase(`${status}.not_retried`, `${status} is not retryable (only 429, 500, 502, 503 and 504 are)`, err(status, 'server', `http_${status}`, 'Server error.'), { class: 'ServerError', code: `http_${status}`, http_status: status }, { max_retries: 3 }),
  ),
  errCase('418.text', 'An unknown 4xx with a text body → InvalidRequestError code http_418', { status: 418, headers: { 'content-type': 'text/plain' }, body_text: "I'm a teapot" }, { class: 'InvalidRequestError', code: 'http_418', http_status: 418 }, { max_retries: 3 }),
  errCase('302.not_followed', 'Redirects are never followed → ServerError unexpected_status', { status: 302, headers: { location: 'https://example.com/elsewhere' }, body_text: '' }, { class: 'ServerError', code: 'unexpected_status', http_status: 302 }, { max_retries: 3 }),
  errCase('422.test_destination_not_allowed', 'Test link to a stranger\'s site → InvalidRequestError with allowed and doc_url', err(422, 'invalid_request', 'test_destination_not_allowed', 'Test links can point to Clikgate\'s test pages, your verified websites, your own computer or Wi-Fi, or a verified tunnel.', 'destination_url', 'req_tl', { allowed: ['clikgate_test_page', 'verified_site', 'local_address', 'verified_tunnel'], doc_url: 'https://clikgate.com/docs/test-mode#test-links' }), { class: 'InvalidRequestError', code: 'test_destination_not_allowed', http_status: 422, param: 'destination_url', allowed: ['clikgate_test_page', 'verified_site', 'local_address', 'verified_tunnel'], doc_url: 'https://clikgate.com/docs/test-mode#test-links' }, { call: 'links.create', args: { params: { destination_url: 'https://someone-else.example/' } }, max_retries: 3 }),
  errCase('403.test_link_limit_reached', 'Too many active test links → PermissionError with limit', err(403, 'permission', 'test_link_limit_reached', 'Test mode allows 200 active test links. Archive some before creating more.', null, 'req_tl2', { limit: 200 }), { class: 'PermissionError', code: 'test_link_limit_reached', http_status: 403, limit: 200 }, { call: 'links.create', args: { params: { destination_url: 'clikgate-test:inspect' } }, max_retries: 3 }),
  errCase('422.https_required', 'Link safety: an http:// destination on an HTTPS-only organisation → InvalidRequestError https_required', err(422, 'invalid_request', 'https_required', "This organisation's links point only to https:// destinations.", 'destination_url'), { class: 'InvalidRequestError', code: 'https_required', http_status: 422, param: 'destination_url' }, { call: 'links.create', args: { params: { destination_url: 'http://example.com/spring' } }, max_retries: 3 }),
  errCase('422.destination_not_allowlisted', 'Link safety: a destination outside the allowlist → InvalidRequestError destination_not_allowlisted', err(422, 'invalid_request', 'destination_not_allowlisted', 'other.example is not on your destination allowlist.', 'destination_url'), { class: 'InvalidRequestError', code: 'destination_not_allowlisted', http_status: 422, param: 'destination_url' }, { call: 'links.update', args: { id: LINK, params: { destination_url: 'https://other.example/' } }, max_retries: 3 }),
  errCase('422.domain_mode_mismatch', 'A live domain on a test link → InvalidRequestError domain_mode_mismatch', err(422, 'invalid_request', 'domain_mode_mismatch', 'Test-mode links always use dev.ciz.to.', 'domain'), { class: 'InvalidRequestError', code: 'domain_mode_mismatch', param: 'domain', allowed: null, doc_url: null }, { call: 'links.create', args: { params: { destination_url: 'clikgate-test:inspect', domain: 'ciz.to' } }, max_retries: 3 }),
  errCase('403.plan_limit_reached', 'Plan allowance used up → PermissionError with required_plan', err(403, 'permission', 'plan_limit_reached', 'Your Starter plan includes 1 custom domain. Upgrade to add more.', 'custom_domains', 'req_pl', { required_plan: 'growth' }), { class: 'PermissionError', code: 'plan_limit_reached', param: 'custom_domains', required_plan: 'growth' }, { call: 'links.create', args: { params: { destination_url: 'https://example.com', domain: 'go.example.com' } }, max_retries: 3 }),
  errCase('403.cli_scope', 'A setup-command token used on an API-key endpoint → PermissionError cli_scope', err(403, 'permission', 'cli_scope', 'Setup command tokens can only set up apps: this endpoint needs a dashboard session or an API key.'), { class: 'PermissionError', code: 'cli_scope', http_status: 403, required_plan: null, limit: null }, { max_retries: 3 }),
  errCase('network', 'A reset connection → NetworkError', { action: 'reset' }, { class: 'NetworkError', code: 'network_error', http_status: null }),
  {
    id: 'errors.timeout',
    description: 'A response slower than the timeout → TimeoutError',
    client: { max_retries: 0, timeout_ms: 300 },
    responses: [{ ...ok(click), delay_ms: 1500 }],
    steps: [{ call: 'clicks.get', args: { id: CLICK }, expect: { error: { class: 'TimeoutError', code: 'timeout', http_status: null } } }],
    expect: { requests: [{}] },
  },
]);

// ---------------------------------------------------------------------------------------------
const created = ok(goalEvent(), 201);
const created_minor = ok(goalEvent({ value: '2000000', value_minor: 200000000, currency: 'NGN' }), 201);
const send = { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-55231', click_id: CLICK, value: '2000000' } };
// change 09 X.E15: goal keys are a random UUID v4 per call (never a hash of the reference).
const k55231 = { $uuid4: true };
const srv = (code = 'unavailable', status = 503, headers = {}) => ({ ...err(status, 'server', code, 'Try again.'), headers: { 'x-request-id': 'req_5xx', ...headers } });
add('retries', 'Retries, full-jitter backoff and Retry-After (SPEC 6)', [
  {
    id: 'retries.503_then_success',
    description: 'Two 503s then 201: three requests with the same Idempotency-Key and body; sleeps 250, 500 with random 0.5',
    responses: [srv(), srv(), created],
    steps: [{ ...send, expect: { result: { counted: true } } }],
    expect: {
      requests: [
        { ...GOAL_POST, headers: { 'idempotency-key': k55231 } },
        { ...GOAL_POST, idempotency_key_same_as: 0 },
        { ...GOAL_POST, idempotency_key_same_as: 0 },
      ],
      sleeps_ms: [250, 500],
    },
  },
  {
    id: 'retries.jitter.zero',
    description: 'random() = 0 gives zero delays',
    random: [0],
    responses: [srv(), srv(), created],
    steps: [send],
    expect: { requests: [{}, {}, {}], sleeps_ms: [0, 0] },
  },
  {
    id: 'retries.jitter.high',
    description: 'random() = 0.999 gives floor(0.999 * 500 * 2^n)',
    random: [0.999],
    responses: [srv(), srv(), created],
    steps: [send],
    expect: { requests: [{}, {}, {}], sleeps_ms: [499, 999] },
  },
  {
    id: 'retries.jitter.sequence',
    description: 'Each retry draws a new random value',
    random: [0.1, 0.9, 0.5],
    responses: [srv(), srv(), srv(), created],
    steps: [send],
    expect: { requests: [{}, {}, {}, {}], sleeps_ms: [50, 900, 1000] },
  },
  {
    id: 'retries.exhausted',
    description: 'max_retries 3: four attempts, then the last error is thrown',
    responses: [srv(), srv(), srv(), srv('internal_error', 500)],
    steps: [{ ...send, expect: { error: { class: 'ServerError', code: 'internal_error', http_status: 500 } } }],
    expect: { requests: [{}, {}, {}, {}], sleeps_ms: [250, 500, 1000] },
  },
  {
    id: 'retries.cap',
    description: 'Backoff is capped at 20 s before jitter: with random 0.5 the 7th delay is 10000',
    client: { max_retries: 7 },
    responses: [srv(), srv(), srv(), srv(), srv(), srv(), srv(), created],
    steps: [send],
    expect: { requests: Array.from({ length: 8 }, () => ({})), sleeps_ms: [250, 500, 1000, 2000, 4000, 8000, 10000] },
  },
  {
    id: 'retries.disabled',
    description: 'max_retries 0: one attempt',
    client: { max_retries: 0 },
    responses: [srv()],
    steps: [{ ...send, expect: { error: { class: 'ServerError', http_status: 503 } } }],
    expect: { requests: [{}], sleeps_ms: [] },
  },
  ...[500, 502, 504].map((status) => ({
    id: `retries.${status}`,
    description: `${status} is retried`,
    responses: [srv('upstream', status), created],
    steps: [send],
    expect: { requests: [{}, { idempotency_key_same_as: 0 }], sleeps_ms: [250] },
  })),
  {
    id: 'retries.429.retry_after_seconds',
    description: '429 with Retry-After: 2 waits exactly 2000 ms (no jitter)',
    responses: [{ ...err(429, 'rate_limited', 'rate_limit_exceeded', 'Too many requests.'), headers: { 'retry-after': '2' } }, created],
    steps: [send],
    expect: { requests: [{}, { idempotency_key_same_as: 0 }], sleeps_ms: [2000] },
  },
  {
    id: 'retries.429.retry_after_too_long',
    description: 'Retry-After above 60 s: no retry, RateLimitError with retry_after',
    responses: [{ ...err(429, 'rate_limited', 'rate_limit_exceeded', 'Too many requests.'), headers: { 'retry-after': '120' } }],
    steps: [{ ...send, expect: { error: { class: 'RateLimitError', retry_after: 120 } } }],
    expect: { requests: [{}], sleeps_ms: [] },
  },
  {
    id: 'retries.429.retry_after_date',
    description: 'Retry-After as an HTTP-date is measured against the SDK clock (now 12:00:00 → 12:00:03 = 3000 ms)',
    responses: [{ ...err(429, 'rate_limited', 'rate_limit_exceeded', 'Too many requests.'), headers: { 'retry-after': 'Mon, 26 Oct 2026 12:00:03 GMT' } }, created],
    steps: [send],
    expect: { requests: [{}, {}], sleeps_ms: [3000] },
  },
  {
    id: 'retries.429.retry_after_invalid',
    description: 'An unparseable Retry-After is ignored: normal backoff',
    responses: [{ ...err(429, 'rate_limited', 'rate_limit_exceeded', 'Too many requests.'), headers: { 'retry-after': 'soon' } }, created],
    steps: [send],
    expect: { requests: [{}, {}], sleeps_ms: [250] },
  },
  {
    id: 'retries.429.no_retry_after',
    description: '429 without Retry-After uses backoff',
    responses: [err(429, 'rate_limited', 'rate_limit_exceeded', 'Too many requests.'), created],
    steps: [send],
    expect: { requests: [{}, {}], sleeps_ms: [250] },
  },
  {
    id: 'retries.503.retry_after',
    description: '503 with Retry-After: 1 waits 1000 ms',
    responses: [srv('unavailable', 503, { 'retry-after': '1' }), created],
    steps: [send],
    expect: { requests: [{}, {}], sleeps_ms: [1000] },
  },
  ...[
    [400, 'invalid_request', 'bad_request', 'InvalidRequestError'],
    [401, 'authentication', 'invalid_credentials', 'AuthenticationError'],
    [403, 'permission', 'insufficient_scope', 'PermissionError'],
    [404, 'not_found', 'goal_not_found', 'NotFoundError'],
    [422, 'invalid_request', 'invalid_value', 'InvalidRequestError'],
  ].map(([status, type, code, cls]) => ({
    id: `retries.no_retry.${status}`,
    description: `${status} is never retried`,
    responses: [err(status, type, code, 'No.')],
    steps: [{ ...send, expect: { error: { class: cls, code, http_status: status } } }],
    expect: { requests: [{}], sleeps_ms: [] },
  })),
  {
    id: 'retries.network_then_success',
    description: 'A reset connection is retried with the same key',
    responses: [{ action: 'reset' }, created],
    steps: [{ ...send, expect: { result: { counted: true } } }],
    expect: { requests: [{ headers: { 'idempotency-key': k55231 } }, { idempotency_key_same_as: 0 }], sleeps_ms: [250] },
  },
  {
    id: 'retries.timeout_then_success',
    description: 'A timeout is retried with the same key and body',
    client: { timeout_ms: 300 },
    responses: [{ ...created, delay_ms: 1500 }, created],
    steps: [{ ...send, expect: { result: { counted: true } } }],
    expect: { requests: [{ headers: { 'idempotency-key': k55231 } }, { idempotency_key_same_as: 0 }], sleeps_ms: [250] },
  },
  {
    id: 'retries.get',
    description: 'GETs are retried too (no Idempotency-Key)',
    responses: [srv('upstream', 502), ok(click)],
    steps: [{ call: 'clicks.get', args: { id: CLICK }, expect: { result: { id: CLICK } } }],
    expect: { requests: [{ method: 'GET' }, { method: 'GET' }], sleeps_ms: [250] },
  },
  {
    id: 'retries.random_key_reused',
    description: 'links.create retries reuse its random UUID v4 key',
    responses: [srv(), ok(link(), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: 'https://example.com/spring' } } }],
    expect: { requests: [{ headers: { 'idempotency-key': { $uuid4: true } } }, { idempotency_key_same_as: 0 }], sleeps_ms: [250] },
  },
]);

// ---------------------------------------------------------------------------------------------
add('idempotency', 'Idempotency keys (SPEC 7)', [
  {
    id: 'idempotency.goal.random',
    description: 'goals.send: Idempotency-Key is a random UUID v4, not a hash of the reference (change 09 X.E15)',
    responses: [created],
    steps: [send],
    expect: { requests: [{ ...GOAL_POST, headers: { 'idempotency-key': { $uuid4: true } } }] },
  },
  {
    id: 'idempotency.goal.not_hash',
    description: 'The key is never sha256_hex(goal:reference), also for non-ASCII references',
    responses: [ok(goalEvent({ reference: 'ORD-ñ-東京-1' }), 201)],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-ñ-東京-1' } }],
    expect: { requests: [{ headers: { 'idempotency-key': { $uuid4: true } }, json: { goal: 'order_paid', reference: 'ORD-ñ-東京-1' } }] },
  },
  {
    id: 'idempotency.goal.same_twice',
    description: 'Sending the same goal and reference twice sends two different keys; the API answers 200 with the stored event, a success',
    responses: [created, ok(goalEvent({ counted: true }), 200)],
    steps: [send, { ...send, expect: { result: { id: 'cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE' } } }],
    expect: { requests: [{ headers: { 'idempotency-key': { $uuid4: true } } }, { headers: { 'idempotency-key': { $uuid4: true } }, idempotency_key_differs_from: 0 }] },
  },
  {
    id: 'idempotency.goal.retry_reuses_key',
    description: 'A 503 then 201: the retry of one goals.send call reuses its random key and body',
    responses: [srv(), created],
    steps: [{ ...send, expect: { result: { counted: true } } }],
    expect: { requests: [{ ...GOAL_POST, headers: { 'idempotency-key': { $uuid4: true } } }, { ...GOAL_POST, idempotency_key_same_as: 0 }], sleeps_ms: [250] },
  },
  {
    id: 'idempotency.goal.override',
    description: 'The idempotency_key request option overrides the random goal key',
    responses: [created],
    steps: [{ ...send, args: { ...send.args, idempotency_key: 'my-goal-key-1' } }],
    expect: { requests: [{ ...GOAL_POST, headers: { 'idempotency-key': 'my-goal-key-1' } }] },
  },
  {
    id: 'idempotency.reverse.random',
    description: 'Reversals use a random key per call (two identical partial refunds are legitimate)',
    responses: [ok(goalEvent()), ok(goalEvent())],
    steps: [
      { call: 'goals.reverse', args: { key: 'order_paid', reference: 'ORD-1', value: '500' } },
      { call: 'goals.reverse', args: { key: 'order_paid', reference: 'ORD-1', value: '500' } },
    ],
    expect: { requests: [{ headers: { 'idempotency-key': { $uuid4: true } } }, { headers: { 'idempotency-key': { $uuid4: true } }, idempotency_key_differs_from: 0 }] },
  },
  {
    id: 'idempotency.batch.random',
    description: 'goals.send_batch uses a random UUID v4',
    responses: [ok({ object: 'list', data: [{ index: 0, ok: true, status: 201, goal_event: goalEvent() }] })],
    steps: [{ call: 'goals.send_batch', args: { events: [{ goal: 'account_opened', reference: 'APP-55231' }] } }],
    expect: { requests: [{ ...BATCH_POST, headers: { 'idempotency-key': { $uuid4: true } } }] },
  },
  {
    id: 'idempotency.patch.random',
    description: 'PATCH sends a random UUID v4',
    responses: [ok(link())],
    steps: [{ call: 'links.update', args: { id: LINK, params: { title: 'Spring' } } }],
    expect: { requests: [{ method: 'PATCH', headers: { 'idempotency-key': { $uuid4: true } } }] },
  },
  {
    id: 'idempotency.conversion.random',
    description: 'conversions.create sends a random UUID v4',
    responses: [ok({ object: 'conversion', id: 'cnv_1' }, 201)],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-9', click_id: CLICK } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', headers: { 'idempotency-key': { $uuid4: true } } }] },
  },
  {
    id: 'idempotency.goal.sync_mode',
    description: 'goal() in sync mode sends one POST /v1/goals/events with a random UUID v4 key',
    client: { send_mode: 'sync' },
    responses: [created],
    steps: [{ call: 'goal', args: { key: 'account_opened', reference: 'APP-55231', click_id: CLICK } }, { call: 'flush', expect: { result: { value: true } } }],
    expect: { requests: [{ ...GOAL_POST, headers: { 'idempotency-key': k55231 }, json: { goal: 'account_opened', reference: 'APP-55231', click_id: CLICK } }], on_error: [] },
  },
]);

// ---------------------------------------------------------------------------------------------
const fmt = (id, value, expected, extra = {}) => ({
  id: `money.format.${id}`,
  description: `format_value(${JSON.stringify(value)}) → ${expected.error ? expected.error.code || expected.error.class : JSON.stringify(expected.value)}`,
  steps: [{ call: 'money.format', args: { value }, expect: expected.error ? { error: expected.error } : { result: { value: expected.value } } }],
  expect: { requests: [], ...(extra.warnings ? { warnings: extra.warnings } : { warnings: [] }) },
  ...(extra.languages ? { languages: extra.languages } : {}),
});
const invalid = { error: { class: 'InvalidRequestError', code: 'invalid_value', http_status: null } };
add('money', 'Money is always a decimal string on the wire (SPEC 8)', [
  fmt('string.integer', '2000000', { value: '2000000' }),
  fmt('string.decimal', '1500.50', { value: '1500.50' }),
  fmt('string.trimmed', ' 12 ', { value: '12' }),
  fmt('string.zero', '0', { value: '0' }),
  fmt('string.leading_zeros', '007', { value: '007' }),
  fmt('string.many_places', '0.125', { value: '0.125' }),
  ...['-5', '1e3', '1,000', '', '.5', '5.', 'abc', 'NaN', '+5', '१२'].map((s, i) => fmt(`string.invalid_${i}`, s, invalid)),
  fmt('integer', 2000000, { value: '2000000' }),
  fmt('integer.zero', 0, { value: '0' }),
  fmt('integer.negative', -1, invalid),
  fmt('decimal', { $decimal: '1500.50' }, { value: '1500.50' }),
  fmt('decimal.integer', { $decimal: '2000000' }, { value: '2000000' }),
  fmt('decimal.exponent', { $decimal: '1E+3' }, { value: '1000' }, { languages: ['python', 'java', 'dotnet'] }),
  fmt('decimal.negative', { $decimal: '-1.50' }, invalid),
  fmt('bigint', { $bigint: '9007199254740993' }, { value: '9007199254740993' }, { languages: ['node', 'python', 'java', 'php'] }),
  fmt('float.node', { $float: 1500.5 }, { value: '1500.5' }, { languages: ['node'], warnings: ['inexact_number'] }),
  fmt('float.node.tenth', { $float: 0.1 }, { value: '0.1' }, { languages: ['node'], warnings: ['inexact_number'] }),
  fmt('float.node.large', { $float: 1e21 }, { value: '1000000000000000000000' }, { languages: ['node'], warnings: ['inexact_number'] }),
  fmt('float.node.tiny', { $float: 1e-7 }, { value: '0.0000001' }, { languages: ['node'], warnings: ['inexact_number'] }),
  fmt('float.node.nan', { $float: 'NaN' }, invalid, { languages: ['node'] }),
  fmt('float.node.infinity', { $float: 'Infinity' }, invalid, { languages: ['node'] }),
  fmt('float.python', { $float: 1500.5 }, { error: { class: 'TypeError' } }, { languages: ['python'] }),
  {
    id: 'money.wire.string',
    description: 'A string value is sent as a JSON string',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-1', value: '1500.50', currency: 'NGN' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'order_paid', reference: 'ORD-1', value: '1500.50', currency: 'NGN' } }] },
  },
  {
    id: 'money.wire.integer',
    description: 'An integer value is sent as a JSON string, never a number',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', value: 2000000 } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', value: '2000000' } }] },
  },
  {
    id: 'money.wire.decimal',
    description: 'A decimal value keeps its scale',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-2', value: { $decimal: '99.90' }, currency: 'USD' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'order_paid', reference: 'ORD-2', value: '99.90', currency: 'USD' } }] },
  },
  {
    id: 'money.wire.absent',
    description: 'No value: no value key (and currency only when given)',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'signup', reference: 'SU-1' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'signup', reference: 'SU-1' } }] },
  },
  {
    id: 'money.wire.invalid_no_request',
    description: 'An invalid value is refused locally; nothing is sent',
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-3', value: '1,500' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_value', param: 'value', http_status: null } } }],
    expect: { requests: [] },
  },
  {
    id: 'money.wire.response_string',
    description: 'Response values stay decimal strings',
    responses: [ok(goalEvent({ value: '1500.50', currency: 'NGN' }), 201)],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-4', value: '1500.50' }, expect: { result: { value: '1500.50' } } }],
    expect: { requests: [{}] },
  },
  {
    id: 'money.wire.conversion',
    description: 'conversions.create formats value too',
    responses: [ok({ object: 'conversion', id: 'cnv_2' }, 201)],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-5', goal: 'order_paid', value: 2000 } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-5', goal: 'order_paid', value: '2000' } }] },
  },
  {
    id: 'money.wire.reverse',
    description: 'goals.reverse formats a partial value',
    responses: [ok(goalEvent({ reversed_value: '500.25' }))],
    steps: [{ call: 'goals.reverse', args: { key: 'order_paid', reference: 'ORD-6', value: '500.25', reason: 'partial refund' } }],
    expect: { requests: [{ method: 'POST', path: '/v1/goals/events/reverse', json: { goal: 'order_paid', reference: 'ORD-6', value: '500.25', reason: 'partial refund' } }] },
  },
  {
    id: 'money.wire.float_warns',
    description: 'Node: a float value is sent as a string and warns inexact_number',
    languages: ['node'],
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-7', value: { $float: 19.99 } } }],
    expect: { requests: [{ json: { goal: 'order_paid', reference: 'ORD-7', value: '19.99' } }], warnings: ['inexact_number'] },
  },
]);

// ---------------------------------------------------------------------------------------------
const batchOk = (n, start = 0) => ok({ object: 'list', data: Array.from({ length: n }, (_, i) => ({ index: i, ok: true, status: 201, goal_event: goalEvent({ reference: `R-${start + i}` }), error: null })) });
const ev = (i) => ({ goal: 'order_paid', reference: `R-${i}` });
const bg = { send_mode: 'background' };
// Change 12 (backend C12 B2): one goal endpoint per sender. A goal call may carry `provider` (a Provider value) and
// `reference`; the goal's kind (never in the call) decides. From the business's server a Payment goal is a trusted
// confirmation (route D): counted with a click ID, else waiting for the browser's or app's report.
const PCF = 'pcf_01JCK8Z9V7Q4M2N6P8R0S2T4PC';
const PRP = 'prp_01JCK8Z9V7Q4M2N6P8R0S2T4PR';
const payGoal = (over = {}) =>
  goalEvent({ goal: 'order_paid', reference: 'T123456', value: '7500', value_minor: 750000, currency: 'NGN', goal_kind: 'payment', ...over });
const paySend = { call: 'goals.send', args: { key: 'order_paid', reference: 'T123456', value: '7500', currency: 'NGN', provider: 'paystack' } };
const PAY_WIRE = { goal: 'order_paid', reference: 'T123456', value: '7500', currency: 'NGN', provider: 'paystack' };
const paymentWaiting = payGoal({
  id: PCF,
  status: 'waiting',
  reason: 'waiting_for_confirmation',
  counted: false,
  event_status: null,
  first_for_click: null,
  is_first: null,
  attributed_to: null,
  payment: { confirmation_id: PCF, match_status: 'waiting_for_report', report_id: null, provider: 'paystack' },
});
const goalErr = (status, type, code, message, param, extra = {}) => err(status, type, code, message, param, 'req_01JCK8Z9V7Q4M2N6P8R0S2T4RQ', extra);
const C12_GOAL_CASES = [
  {
    id: 'goals.send.status.counted',
    description: 'Change 12: a counted standard goal returns status counted, goal_kind standard, and the conversion state in event_status',
    responses: [created],
    steps: [{ ...send, expect: { result: { status: 'counted', reason: null, goal_kind: 'standard', counted: true, value_ignored: false, event_status: 'attributed', payment: null } } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-55231', click_id: CLICK, value: '2000000' } }] },
  },
  {
    id: 'goals.send.status.refused_bot',
    description: 'Change 12: a goal on a bot click is refused (201): status refused, reason rejected_bot; not an error',
    responses: [ok(goalEvent({ status: 'refused', reason: 'rejected_bot', counted: false, event_status: 'rejected_bot' }), 201)],
    steps: [{ ...send, expect: { result: { status: 'refused', reason: 'rejected_bot', counted: false, event_status: 'rejected_bot' } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'goals.send.status.refused_outside_window',
    description: 'Change 12: outside the goal window → status refused, reason outside_window',
    responses: [ok(goalEvent({ status: 'refused', reason: 'outside_window', counted: false, event_status: 'unattributed', attributed_to: null }), 201)],
    steps: [{ ...send, expect: { result: { status: 'refused', reason: 'outside_window', counted: false } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'goals.send.status.waiting_pending_click',
    description: 'Change 12: recorded after an outage, waiting for its click → status waiting, reason pending_click',
    responses: [ok(goalEvent({ status: 'waiting', reason: 'pending_click', counted: false, event_status: 'pending_click', attributed_to: null }), 201)],
    steps: [{ ...send, expect: { result: { status: 'waiting', reason: 'pending_click', counted: false } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'goals.send.provider',
    description: 'Change 12: provider is a wire field of every goal call (a standard goal checks it and otherwise ignores it)',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-9', provider: 'flutterwave' }, expect: { result: { status: 'counted', goal_kind: 'standard' } } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-9', provider: 'flutterwave' } }] },
  },
  {
    id: 'goals.send.provider_newer_gateway',
    description: 'Change 12: a provider this SDK release does not know (a newer gateway) is sent as given; the API validates it',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'T-77', value: '10', provider: 'acme_pay' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'order_paid', reference: 'T-77', value: '10', provider: 'acme_pay' } }] },
  },
  ...[
    ['upper_case', 'Paystack'],
    ['dash', 'mtn-momo'],
    ['empty', ''],
  ].map(([name, provider]) => ({
    id: `goals.send.invalid_provider.${name}`,
    description: `Change 12: provider ${JSON.stringify(provider)} is refused locally (a provider key is lower-case snake_case)`,
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'T-78', provider }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_provider', param: 'provider', http_status: null } } }],
    expect: { requests: [] },
  })),
  {
    id: 'goals.send.payment.waiting',
    description: 'Change 12: a Payment goal sent by the server without a click ID waits for its report: status waiting, the confirmation id, payment details',
    responses: [ok(paymentWaiting, 201)],
    steps: [
      {
        ...paySend,
        expect: {
          result: {
            id: PCF,
            status: 'waiting',
            reason: 'waiting_for_confirmation',
            goal_kind: 'payment',
            counted: false,
            event_status: null,
            value: '7500',
            value_minor: 750000,
            payment: { confirmation_id: PCF, match_status: 'waiting_for_report', report_id: null, provider: 'paystack' },
          },
        },
      },
    ],
    expect: { requests: [{ ...GOAL_POST, json: PAY_WIRE }] },
  },
  {
    id: 'goals.send.payment.counted',
    description: 'Change 12: a Payment goal sent by the server with a click ID is counted at once with the value sent',
    responses: [ok(payGoal({ payment: { confirmation_id: PCF, match_status: 'matched', report_id: PRP, provider: 'paystack' } }), 201)],
    steps: [
      {
        call: 'goals.send',
        args: { ...paySend.args, click_id: CLICK },
        expect: { result: { status: 'counted', goal_kind: 'payment', counted: true, event_status: 'attributed', value: '7500', payment: { match_status: 'matched', report_id: PRP } } },
      },
    ],
    expect: { requests: [{ ...GOAL_POST, json: { ...PAY_WIRE, click_id: CLICK } }] },
  },
  {
    id: 'goals.send.payment.already_counted',
    description: 'Change 12: a payment reference already counted (200) is refused with reason already_counted; a success, not an error',
    responses: [ok(payGoal({ ...paymentWaiting, status: 'refused', reason: 'already_counted', payment: { confirmation_id: PCF, match_status: 'duplicate', report_id: null, provider: 'paystack' } }))],
    steps: [{ ...paySend, expect: { result: { status: 'refused', reason: 'already_counted', counted: false, goal_kind: 'payment', payment: { match_status: 'duplicate' } } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'goals.send.payment.missing_provider',
    description: 'Change 12: a server Payment goal needs provider and reference (no default provider): the SDK sends what it is given (it never knows the kind) and the API answers 422 payment_goal_needs_confirmation with missing',
    responses: [goalErr(422, 'invalid_request', 'payment_goal_needs_confirmation', 'order_paid is a Payment goal: send provider and reference so your payment provider or server can confirm it.', 'provider', { missing: ['provider'] })],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'T123456', value: '7500', click_id: CLICK }, expect: { error: { class: 'InvalidRequestError', code: 'payment_goal_needs_confirmation', param: 'provider', http_status: 422 } } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'order_paid', reference: 'T123456', value: '7500', click_id: CLICK } }] },
  },
  // Change 12 B2 error codes: plain API errors, mapped by SPEC 5 and never retried
  ...[
    ['unknown_provider', 422, 'invalid_request', 'Unknown provider "acme_pay". Use a provider from GET /v1/payment-gateways.', 'provider', {}, { ...paySend.args, provider: 'acme_pay' }],
    ['value_required', 422, 'invalid_request', 'A Payment goal sent by your server needs a value.', 'value', {}, { key: 'order_paid', reference: 'T123456', provider: 'paystack' }],
    ['invalid_value', 422, 'invalid_request', "A payment's value must be more than 0.", 'value', {}, { ...paySend.args, value: '0' }],
    ['code_not_supported', 422, 'invalid_request', 'Payment goals take click_id, not code: send the click ID.', 'code', {}, { ...paySend.args, code: 'TOLU20' }],
    [
      'payment_goal_needs_confirmation',
      422,
      'invalid_request',
      'order_paid is a Payment goal: send provider and reference so your payment provider or server can confirm it.',
      'provider',
      { missing: ['provider'] },
      { key: 'order_paid', reference: 'T123456', value: '7500' },
    ],
    ['validation_error', 422, 'invalid_request', 'kind is not a goal call field: the kind lives in the goal settings.', 'kind', {}, { ...paySend.args, extra: { kind: 'standard' } }],
  ].map(([code, status, type, message, param, extra, args]) => ({
    id: `goals.send.error.${code}`,
    description: `Change 12: ${status} ${code} is an InvalidRequestError with its param; not retried`,
    responses: [goalErr(status, type, code, message, param, extra)],
    steps: [{ call: 'goals.send', args, expect: { error: { class: 'InvalidRequestError', code, param, http_status: status } } }],
    expect: { requests: [GOAL_POST] },
  })),
  {
    id: 'goals.send.error.plan_feature_unavailable',
    description: 'Change 12: a Payment goal on Free → 403 plan_feature_unavailable, a PermissionError with required_plan starter',
    client: { max_retries: 3 },
    responses: [goalErr(403, 'permission', 'plan_feature_unavailable', "You're on Free. Payment goals are included from Starter. Upgrade to Starter to use them.", null, { feature: 'payment_goals', required_plan: 'starter' })],
    steps: [{ ...paySend, expect: { error: { class: 'PermissionError', code: 'plan_feature_unavailable', http_status: 403, required_plan: 'starter' } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'goals.batch.status_values',
    description: 'Change 12: batch items carry the GoalStatus in goal_event.status (counted, waiting, refused) and errors per item',
    responses: [
      ok({
        object: 'list',
        data: [
          { index: 0, ok: true, status: 201, goal_event: goalEvent({ reference: 'R-0' }), error: null },
          { index: 1, ok: true, status: 201, goal_event: paymentWaiting, error: null },
          { index: 2, ok: true, status: 200, goal_event: goalEvent({ reference: 'R-2', status: 'refused', reason: 'already_counted_for_click', counted: false }), error: null },
          { index: 3, ok: false, status: 422, goal_event: null, error: { type: 'invalid_request', code: 'unknown_provider', message: 'Unknown provider.', param: 'provider' } },
        ],
      }),
    ],
    steps: [
      {
        call: 'goals.send_batch',
        args: {
          events: [
            { goal: 'account_opened', reference: 'R-0' },
            { goal: 'order_paid', reference: 'T123456', value: '7500', currency: 'NGN', provider: 'paystack' },
            { goal: 'account_opened', reference: 'R-2', click_id: CLICK },
            { goal: 'order_paid', reference: 'T-3', value: '10', provider: 'acme_pay' },
          ],
        },
        expect: {
          result: {
            object: 'list',
            data: [
              { index: 0, ok: true, goal_event: { status: 'counted', goal_kind: 'standard' } },
              { index: 1, ok: true, goal_event: { status: 'waiting', reason: 'waiting_for_confirmation', goal_kind: 'payment', payment: { confirmation_id: PCF } } },
              { index: 2, ok: true, status: 200, goal_event: { status: 'refused', reason: 'already_counted_for_click' } },
              { index: 3, ok: false, status: 422, error: { code: 'unknown_provider', param: 'provider' } },
            ],
          },
        },
      },
    ],
    expect: {
      requests: [
        {
          ...BATCH_POST,
          json: {
            events: [
              { goal: 'account_opened', reference: 'R-0' },
              { goal: 'order_paid', reference: 'T123456', value: '7500', currency: 'NGN', provider: 'paystack' },
              { goal: 'account_opened', reference: 'R-2', click_id: CLICK },
              { goal: 'order_paid', reference: 'T-3', value: '10', provider: 'acme_pay' },
            ],
          },
        },
      ],
    },
  },
  {
    id: 'goals.batch.invalid_provider',
    description: 'Change 12: a batch event with a malformed provider throws with its index; nothing is sent',
    steps: [{ call: 'goals.send_batch', args: { events: [ev(0), { goal: 'order_paid', reference: 'R-1', provider: 'PayStack' }] }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_provider', param: 'provider', index: 1 } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.background.payment_waiting',
    description: 'Change 12: background goal() with provider; a waiting Payment goal (ok item) is not an error: on_error stays empty',
    client: { send_mode: 'background' },
    responses: [ok({ object: 'list', data: [{ index: 0, ok: true, status: 201, goal_event: paymentWaiting, error: null }] })],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'T123456', value: '7500', currency: 'NGN', provider: 'paystack' } }, { call: 'flush', expect: { result: { value: true } } }],
    expect: { requests: [{ ...BATCH_POST, json: { events: [PAY_WIRE] } }], on_error: [] },
  },
  {
    id: 'goals.background.payment_item_error',
    description: 'Change 12: a batch item refused with value_required (a server Payment goal without a value) goes to on_error',
    client: { send_mode: 'background' },
    responses: [ok({ object: 'list', data: [{ index: 0, ok: false, status: 422, goal_event: null, error: { type: 'invalid_request', code: 'value_required', message: 'A Payment goal sent by your server needs a value.', param: 'value' } }] })],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'T123456', provider: 'paystack' } }, { call: 'flush' }],
    expect: { requests: [{ ...BATCH_POST, json: { events: [{ goal: 'order_paid', reference: 'T123456', provider: 'paystack' }] } }], on_error: [{ class: 'InvalidRequestError', code: 'value_required', http_status: 422, events: [{ goal: 'order_paid', reference: 'T123456' }] }] },
  },
  {
    id: 'goals.background.invalid_provider',
    description: 'Change 12: goal() with a malformed provider never throws: on_error invalid_provider, nothing queued',
    client: { send_mode: 'background' },
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'T-1', provider: 'Paystack' } }, { call: 'flush' }],
    expect: { requests: [], on_error: [{ class: 'InvalidRequestError', code: 'invalid_provider', events: [{ goal: 'order_paid', reference: 'T-1' }] }] },
  },
];
add('goals', 'Goals: send, batch, reverse, background queueing and flush (SPEC 9)', [
  {
    id: 'goals.send.full',
    description: 'All options map to wire fields; the goal_event is returned',
    responses: [created],
    steps: [
      {
        call: 'goals.send',
        args: { key: 'account_opened', click_id: CLICK, reference: 'APP-55231', value: '2000000', currency: 'NGN', is_first: true, occurred_at: { $datetime: '2026-10-23T09:12:00Z' } },
        expect: { result: { object: 'goal_event', counted: true, status: 'counted', reason: null, goal_kind: 'standard', event_status: 'attributed', first_for_click: true, attributed_to: { link_id: LINK } } },
      },
    ],
    expect: { requests: [{ ...GOAL_POST, query: {}, json: { goal: 'account_opened', click_id: CLICK, reference: 'APP-55231', value: '2000000', currency: 'NGN', is_first: true, occurred_at: '2026-10-23T09:12:00Z' } }] },
  },
  {
    id: 'goals.send.minimal',
    description: 'Only goal and reference: unattributed events are allowed (the server stores no_click)',
    responses: [ok(goalEvent({ status: 'refused', reason: 'unattributed', event_status: 'unattributed', attributed_to: null, counted: false, unattributed_reason: 'no_click' }), 201)],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2' }, expect: { result: { status: 'refused', reason: 'unattributed', event_status: 'unattributed', attributed_to: null } } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-2' } }] },
  },
  {
    id: 'goals.send.code',
    description: 'An offline or creator code instead of a click ID',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-3', code: 'TOLU20' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-3', code: 'TOLU20' } }] },
  },
  {
    id: 'goals.send.is_first_false',
    description: 'is_first false is sent (false is not "unset")',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-4', is_first: false } }],
    expect: { requests: [{ json: { goal: 'account_opened', reference: 'APP-4', is_first: false } }] },
  },
  {
    id: 'goals.send.occurred_at_ms',
    description: 'A datetime with milliseconds keeps them',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-5', occurred_at: { $datetime: '2026-10-23T09:12:00.123Z' } } }],
    expect: { requests: [{ json: { goal: 'account_opened', reference: 'APP-5', occurred_at: '2026-10-23T09:12:00.123Z' } }] },
  },
  {
    id: 'goals.send.occurred_at_string',
    description: 'A string occurred_at is passed through unchanged',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-6', occurred_at: '2026-10-23T10:12:00+01:00' } }],
    expect: { requests: [{ json: { goal: 'account_opened', reference: 'APP-6', occurred_at: '2026-10-23T10:12:00+01:00' } }] },
  },
  {
    id: 'goals.send.metadata_consent_extra',
    description: 'Outside private mode metadata, consent and extra fields are sent',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'ORD-8', metadata: { plan: 'gold' }, consent: { attribution: 'granted' }, extra: { future_field: 1 } } }],
    expect: { requests: [{ json: { goal: 'order_paid', reference: 'ORD-8', metadata: { plan: 'gold' }, consent: { attribution: 'granted' }, future_field: 1 } }] },
  },
  {
    id: 'goals.send.duplicate_200',
    description: 'A 200 (already received) is a success, not an error',
    responses: [ok(goalEvent({ status: 'refused', counted: false, reason: 'already_counted_for_click' }))],
    steps: [{ ...send, expect: { result: { status: 'refused', counted: false, reason: 'already_counted_for_click' } } }],
    expect: { requests: [{}] },
  },
  ...C12_GOAL_CASES,
  {
    id: 'goals.send.value_minor',
    description: 'The result keeps value as a decimal string and value_minor as an integer (change 09 X.E10)',
    responses: [created_minor],
    steps: [{ ...send, expect: { result: { value: '2000000', value_minor: 200000000, currency: 'NGN' } } }],
    expect: { requests: [{}] },
  },
  {
    id: 'goals.send.click_id_and_code',
    description: 'click_id and code together are refused locally',
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-7', click_id: CLICK, code: 'TOLU20' }, expect: { error: { class: 'InvalidRequestError', code: 'click_id_and_code', http_status: null } } }],
    expect: { requests: [] },
  },
  ...[
    ['uppercase', 'Account_Opened'],
    ['dash', 'account-opened'],
    ['too_short', 'a'],
    ['too_long', `a${'b'.repeat(40)}`],
    ['digit_first', '1goal'],
  ].map(([name, key]) => ({
    id: `goals.send.invalid_key.${name}`,
    description: `Goal key ${JSON.stringify(key)} is refused locally`,
    steps: [{ call: 'goals.send', args: { key, reference: 'APP-8' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_goal_key', param: 'goal', http_status: null } } }],
    expect: { requests: [] },
  })),
  {
    id: 'goals.send.missing_reference',
    description: 'A reference is required',
    steps: [{ call: 'goals.send', args: { key: 'account_opened' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_reference', param: 'reference' } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.send.long_reference',
    description: 'A reference over 128 characters is refused',
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'R'.repeat(129) }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_reference', param: 'reference' } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.send.reference_128',
    description: 'A 128-character reference is fine',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'R'.repeat(128) } }],
    expect: { requests: [{ headers: { 'idempotency-key': { $uuid4: true } }, json: { goal: 'account_opened', reference: 'R'.repeat(128) } }] },
  },
  {
    id: 'goals.batch.basic',
    description: 'send_batch posts {events} and returns per-item results without throwing',
    responses: [ok({ object: 'list', data: [{ index: 0, ok: true, status: 201, goal_event: goalEvent({ reference: 'R-0' }), error: null }, { index: 1, ok: false, status: 422, goal_event: null, error: { type: 'invalid_request', code: 'invalid_value', message: 'Bad value.', param: 'value' } }] })],
    steps: [
      {
        call: 'goals.send_batch',
        args: { events: [{ goal: 'order_paid', reference: 'R-0', value: 100 }, { goal: 'order_paid', reference: 'R-1', click_id: CLICK2, value: '1.005' }] },
        expect: { result: { object: 'list', data: [{ index: 0, ok: true }, { index: 1, ok: false, status: 422, error: { code: 'invalid_value' } }] } },
      },
    ],
    expect: { requests: [{ ...BATCH_POST, json: { events: [{ goal: 'order_paid', reference: 'R-0', value: '100' }, { goal: 'order_paid', reference: 'R-1', click_id: CLICK2, value: '1.005' }] } }] },
  },
  {
    id: 'goals.batch.empty',
    description: 'An empty batch is refused locally',
    steps: [{ call: 'goals.send_batch', args: { events: [] }, expect: { error: { class: 'InvalidRequestError', code: 'batch_empty' } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.batch.too_large',
    description: 'More than 500 events are refused locally',
    steps: [{ call: 'goals.send_batch', args: { events: Array.from({ length: 501 }, (_, i) => ev(i)) }, expect: { error: { class: 'InvalidRequestError', code: 'batch_too_large' } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.batch.invalid_item',
    description: 'A locally invalid event throws with its index and nothing is sent',
    steps: [{ call: 'goals.send_batch', args: { events: [ev(0), { goal: 'Bad-Key', reference: 'R-1' }] }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_goal_key', index: 1 } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.reverse.full',
    description: 'A full reversal sends goal and reference only',
    responses: [ok(goalEvent({ reversed_value: '2000000' }))],
    steps: [{ call: 'goals.reverse', args: { key: 'loan_disbursed', reference: 'LN-2201' }, expect: { result: { reversed_value: '2000000' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/goals/events/reverse', json: { goal: 'loan_disbursed', reference: 'LN-2201' } }] },
  },
  {
    id: 'goals.reverse.missing_reference',
    description: 'A reversal needs a reference',
    steps: [{ call: 'goals.reverse', args: { key: 'loan_disbursed', reference: '' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_reference' } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.background.batch',
    description: 'Background: three goal() calls and flush → one batch request, in order',
    client: bg,
    responses: [batchOk(3)],
    steps: [
      { call: 'goal', args: { key: 'order_paid', reference: 'R-0', value: '10' } },
      { call: 'goal', args: { key: 'order_paid', reference: 'R-1', click_id: CLICK } },
      { call: 'goal', args: { key: 'signup', reference: 'R-2' } },
      { call: 'flush', expect: { result: { value: true } } },
    ],
    expect: {
      requests: [{ ...BATCH_POST, headers: { 'idempotency-key': { $uuid4: true } }, json: { events: [{ goal: 'order_paid', reference: 'R-0', value: '10' }, { goal: 'order_paid', reference: 'R-1', click_id: CLICK }, { goal: 'signup', reference: 'R-2' }] } }],
      on_error: [],
    },
  },
  {
    id: 'goals.background.batch_size',
    description: 'Background: batch_size 2 and five goals → batches of 2, 2 and 1',
    client: { ...bg, batch_size: 2 },
    responses: [batchOk(2), batchOk(2, 2), batchOk(1, 4)],
    steps: [...[0, 1, 2, 3, 4].map((i) => ({ call: 'goal', args: { key: 'order_paid', reference: `R-${i}` } })), { call: 'flush' }],
    expect: {
      requests: [
        { ...BATCH_POST, json: { events: [ev(0), ev(1)] } },
        { ...BATCH_POST, json: { events: [ev(2), ev(3)] } },
        { ...BATCH_POST, json: { events: [ev(4)] } },
      ],
      on_error: [],
    },
  },
  {
    id: 'goals.background.flush_empty',
    description: 'flush with nothing queued sends nothing and returns true',
    client: bg,
    steps: [{ call: 'flush', expect: { result: { value: true } } }],
    expect: { requests: [] },
  },
  {
    id: 'goals.background.item_error',
    description: 'A failed batch item goes to on_error (mapped by its status and error); goal() never throws',
    client: bg,
    responses: [ok({ object: 'list', data: [{ index: 0, ok: true, status: 201, goal_event: goalEvent(), error: null }, { index: 1, ok: false, status: 422, goal_event: null, error: { type: 'invalid_request', code: 'value_required', message: 'This goal needs a value.', param: 'value' } }] })],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'goal', args: { key: 'loan_disbursed', reference: 'LN-1' } }, { call: 'flush' }],
    expect: { requests: [BATCH_POST], on_error: [{ class: 'InvalidRequestError', code: 'value_required', http_status: 422, events: [{ goal: 'loan_disbursed', reference: 'LN-1' }] }] },
  },
  {
    id: 'goals.background.auth_failure',
    description: 'A non-retryable whole-batch failure drops the events and calls on_error once',
    client: bg,
    responses: [err(401, 'authentication', 'invalid_credentials', 'Invalid credentials.')],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'goal', args: { key: 'order_paid', reference: 'R-1' } }, { call: 'flush' }, { call: 'flush' }],
    expect: { requests: [BATCH_POST], on_error: [{ class: 'AuthenticationError', code: 'invalid_credentials', dropped: true, events: [ev(0), ev(1)] }] },
  },
  {
    id: 'goals.background.requeue',
    description: 'A retryable whole-batch failure re-queues the events; after 3 failed rounds they are dropped',
    client: { ...bg, max_retries: 0 },
    responses: [srv(), srv(), srv()],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'flush' }, { call: 'flush' }, { call: 'flush' }, { call: 'flush' }],
    expect: {
      requests: [
        { ...BATCH_POST, json: { events: [ev(0)] } },
        { ...BATCH_POST, json: { events: [ev(0)] }, idempotency_key_differs_from: 0 },
        { ...BATCH_POST, json: { events: [ev(0)] } },
      ],
      on_error: [{ class: 'ServerError', http_status: 503, dropped: true, events: [ev(0)] }],
    },
  },
  {
    id: 'goals.background.501_dropped',
    description: 'A whole-batch 501 is not retryable: one request, the events are dropped and passed to on_error at once',
    client: { ...bg, max_retries: 3 },
    responses: [srv('not_implemented', 501)],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'flush' }, { call: 'flush' }],
    expect: { requests: [{ ...BATCH_POST, json: { events: [ev(0)] } }], on_error: [{ class: 'ServerError', code: 'not_implemented', http_status: 501, dropped: true, events: [ev(0)] }] },
  },
  {
    id: 'goals.background.requeue_then_success',
    description: 'Re-queued events are sent on the next flush, ahead of newer ones',
    client: { ...bg, max_retries: 0 },
    responses: [srv(), batchOk(2)],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'flush' }, { call: 'goal', args: { key: 'order_paid', reference: 'R-1' } }, { call: 'flush' }],
    expect: { requests: [{ json: { events: [ev(0)] } }, { json: { events: [ev(0), ev(1)] } }], on_error: [] },
  },
  {
    id: 'goals.background.queue_full',
    description: 'When the queue is full the oldest event is dropped (warning + on_error queue_full)',
    client: { ...bg, max_queue_size: 2 },
    responses: [batchOk(2, 1)],
    steps: [0, 1, 2].map((i) => ({ call: 'goal', args: { key: 'order_paid', reference: `R-${i}` } })).concat([{ call: 'flush' }]),
    expect: { requests: [{ json: { events: [ev(1), ev(2)] } }], warnings: ['queue_full_dropped'], on_error: [{ class: 'InvalidRequestError', code: 'queue_full', dropped: true, events: [ev(0)] }] },
  },
  {
    id: 'goals.background.invalid_never_throws',
    description: 'goal() with an invalid key never throws: on_error, nothing queued',
    client: bg,
    steps: [{ call: 'goal', args: { key: 'Bad Key', reference: 'R-0' } }, { call: 'flush' }],
    expect: { requests: [], on_error: [{ class: 'InvalidRequestError', code: 'invalid_goal_key', events: [{ goal: 'Bad Key', reference: 'R-0' }] }] },
  },
  {
    id: 'goals.background.close',
    description: 'close() flushes; goal() after close goes to on_error client_closed',
    client: bg,
    responses: [batchOk(1)],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'close', expect: { result: { value: true } } }, { call: 'goal', args: { key: 'order_paid', reference: 'R-1' } }],
    expect: { requests: [{ json: { events: [ev(0)] } }], on_error: [{ class: 'InvalidRequestError', code: 'client_closed', events: [ev(1)] }] },
  },
  {
    id: 'goals.sync.error_to_on_error',
    description: 'goal() in sync mode: a 422 goes to on_error, never thrown',
    client: { send_mode: 'sync' },
    responses: [err(422, 'invalid_request', 'value_not_allowed', 'This goal takes no value.', 'value')],
    steps: [{ call: 'goal', args: { key: 'signup', reference: 'SU-9', value: '5' } }, { call: 'flush' }],
    expect: { requests: [GOAL_POST], on_error: [{ class: 'InvalidRequestError', code: 'value_not_allowed', events: [{ goal: 'signup', reference: 'SU-9' }] }] },
  },
]);

// ---------------------------------------------------------------------------------------------
const PM = 'secret@example.com';
const guardErr = (field, extra = {}) => ({ class: 'PrivateModeFieldRejectedError', code: 'private_mode_field_rejected', field, param: field, http_status: null, message_excludes: [PM], ...extra });
const auto = { private_mode: 'auto' };
add('private_mode', 'Server SDK config and the private-mode guard (SPEC 12)', [
  {
    id: 'private_mode.on.metadata',
    description: 'private_mode true: metadata is refused locally and nothing reaches HTTP',
    client: { private_mode: true },
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { email: PM } }, expect: { error: guardErr('metadata') } }],
    expect: { requests: [], logs_exclude: [PM] },
  },
  {
    id: 'private_mode.on.consent',
    description: 'consent (the four-purpose consent object) is allowed in private mode, as the backend allows it since change 09',
    client: { private_mode: true },
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', consent: { attribution: 'granted', analytics: 'denied' } } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', consent: { attribution: 'granted', analytics: 'denied' } } }] },
  },
  {
    id: 'private_mode.on.consent_batch_background_conversion',
    description: 'consent is allowed on batch items, background goal() and conversions in private mode',
    client: { private_mode: true, send_mode: 'background' },
    responses: [batchOk(1), batchOk(1), ok({ object: 'conversion', id: 'cnv_7' }, 201)],
    steps: [
      { call: 'goals.send_batch', args: { events: [{ goal: 'order_paid', reference: 'R-0', consent: { attribution: 'granted' } }] } },
      { call: 'goal', args: { key: 'order_paid', reference: 'R-1', consent: { ad_user_data: 'granted' } } },
      { call: 'flush' },
      { call: 'conversions.create', args: { params: { external_id: 'ORD-3', goal: 'order_paid', consent: { attribution: 'granted' } } } },
    ],
    expect: {
      requests: [
        { ...BATCH_POST, json: { events: [{ goal: 'order_paid', reference: 'R-0', consent: { attribution: 'granted' } }] } },
        { ...BATCH_POST, json: { events: [{ goal: 'order_paid', reference: 'R-1', consent: { ad_user_data: 'granted' } }] } },
        { method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-3', goal: 'order_paid', consent: { attribution: 'granted' } } },
      ],
      on_error: [],
    },
  },
  {
    id: 'private_mode.on.metadata_still_refused_with_consent',
    description: 'metadata is still refused when consent is sent alongside it',
    client: { private_mode: true },
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', consent: { attribution: 'granted' }, metadata: { email: PM } }, expect: { error: guardErr('metadata') } }],
    expect: { requests: [], logs_exclude: [PM] },
  },
  {
    id: 'private_mode.on.extra_email',
    description: 'An extra email field is refused by name',
    client: { private_mode: true },
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', extra: { email: PM } }, expect: { error: guardErr('email') } }],
    expect: { requests: [], logs_exclude: [PM] },
  },
  {
    id: 'private_mode.on.order',
    description: 'The first refused field is metadata, then consent, then alphabetical',
    client: { private_mode: true },
    steps: [
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { a: 1 }, extra: { hashed_phone: 'abc' } }, expect: { error: guardErr('metadata') } },
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', extra: { zeta: 1, alpha: 2 } }, expect: { error: guardErr('alpha') } },
    ],
    expect: { requests: [] },
  },
  {
    id: 'private_mode.on.allowed',
    description: 'The allow-list fields are sent',
    client: { private_mode: true },
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-55231', click_id: CLICK, value: '2000000', currency: 'NGN', is_first: true, occurred_at: '2026-10-23T09:12:00Z' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-55231', click_id: CLICK, value: '2000000', currency: 'NGN', is_first: true, occurred_at: '2026-10-23T09:12:00Z' } }] },
  },
  {
    id: 'private_mode.on.provider_allowed',
    description: 'Change 12 (backend V.7): provider is on the goal allow-list (a gateway name, not personal data)',
    client: { private_mode: true },
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'T123456', click_id: CLICK, value: '7500', currency: 'NGN', provider: 'paystack' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'order_paid', reference: 'T123456', click_id: CLICK, value: '7500', currency: 'NGN', provider: 'paystack' } }] },
  },
  {
    id: 'private_mode.on.provider_batch_and_conversion',
    description: 'Change 12: provider is allowed on batch items and conversions in private mode too',
    client: { private_mode: true },
    responses: [batchOk(1), ok({ object: 'conversion', id: 'cnv_5' }, 201)],
    steps: [
      { call: 'goals.send_batch', args: { events: [{ goal: 'order_paid', reference: 'R-0', provider: 'stripe' }] } },
      { call: 'conversions.create', args: { params: { external_id: 'ORD-2', goal: 'order_paid', value: '10', provider: 'stripe' } } },
    ],
    expect: {
      requests: [
        { ...BATCH_POST, json: { events: [{ goal: 'order_paid', reference: 'R-0', provider: 'stripe' }] } },
        { method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-2', goal: 'order_paid', value: '10', provider: 'stripe' } },
      ],
    },
  },
  {
    id: 'private_mode.on.null_is_unset',
    description: 'A null metadata is "unset", not refused',
    client: { private_mode: true },
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2', metadata: null } }],
    expect: { requests: [{ json: { goal: 'account_opened', reference: 'APP-2' } }] },
  },
  {
    id: 'private_mode.on.reverse_reason',
    description: 'Free-text reason on a reversal is refused',
    client: { private_mode: true },
    steps: [{ call: 'goals.reverse', args: { key: 'loan_disbursed', reference: 'LN-1', reason: 'customer Ada asked' }, expect: { error: guardErr('reason') } }],
    expect: { requests: [] },
  },
  {
    id: 'private_mode.on.reverse_value',
    description: 'A partial reversal value is allowed',
    client: { private_mode: true },
    responses: [ok(goalEvent())],
    steps: [{ call: 'goals.reverse', args: { key: 'loan_disbursed', reference: 'LN-1', value: '1000' } }],
    expect: { requests: [{ json: { goal: 'loan_disbursed', reference: 'LN-1', value: '1000' } }] },
  },
  {
    id: 'private_mode.on.conversion_allowed',
    description: 'conversions.create allows external_id with the goal fields',
    client: { private_mode: true },
    responses: [ok({ object: 'conversion', id: 'cnv_3' }, 201)],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-1', click_id: CLICK, goal: 'order_paid', value: '1500.50', currency: 'NGN' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-1', click_id: CLICK, goal: 'order_paid', value: '1500.50', currency: 'NGN' } }] },
  },
  ...[
    ['type', { type: 'purchase' }],
    ['amount_minor', { amount_minor: 150050 }],
    ['customer', { customer: { email: PM } }],
  ].map(([field, extra]) => ({
    id: `private_mode.on.conversion_${field}`,
    description: `conversions.create refuses ${field}`,
    client: { private_mode: true },
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-1', click_id: CLICK, ...extra } }, expect: { error: guardErr(field) } }],
    expect: { requests: [], logs_exclude: [PM] },
  })),
  {
    id: 'private_mode.on.batch',
    description: 'A refused field in a batch throws with the index; nothing is sent',
    client: { private_mode: true },
    steps: [{ call: 'goals.send_batch', args: { events: [ev(0), { ...ev(1), metadata: { email: PM } }] }, expect: { error: guardErr('metadata', { index: 1 }) } }],
    expect: { requests: [] },
  },
  {
    id: 'private_mode.on.background_redacts',
    description: 'Background: a refused event goes to on_error with the reference redacted; the others are sent',
    client: { ...bg, private_mode: true },
    responses: [batchOk(1)],
    steps: [
      { call: 'goal', args: { key: 'account_opened', reference: 'APP-SECRET-77', metadata: { email: PM } } },
      { call: 'goal', args: { key: 'account_opened', reference: 'APP-OK-1' } },
      { call: 'flush' },
    ],
    expect: {
      requests: [{ json: { events: [{ goal: 'account_opened', reference: 'APP-OK-1' }] } }],
      on_error: [{ class: 'PrivateModeFieldRejectedError', field: 'metadata', events: [{ goal: 'account_opened', reference: '[redacted]' }] }],
      logs_exclude: ['APP-SECRET-77', 'APP-OK-1', PM],
    },
  },
  {
    id: 'private_mode.off.no_config',
    description: 'private_mode false never fetches config and sends metadata',
    client: { private_mode: false },
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { plan: 'gold' } } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', metadata: { plan: 'gold' } } }] },
  },
  {
    id: 'private_mode.auto.on',
    description: 'auto + config private_mode true: config is fetched, then metadata is refused locally',
    client: auto,
    responses: [ok(config({ private_mode: true }))],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { email: PM } }, expect: { error: guardErr('metadata') } }],
    expect: { requests: [CONFIG_GET] },
  },
  {
    id: 'private_mode.auto.off',
    description: 'auto + config private_mode false: metadata is sent',
    client: auto,
    responses: [ok(config()), created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { plan: 'gold' } } }],
    expect: { requests: [CONFIG_GET, { ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', metadata: { plan: 'gold' } } }], warnings: [] },
  },
  {
    id: 'private_mode.auto.cached',
    description: 'Config is cached: two sends, one config request',
    client: auto,
    responses: [ok(config()), created, created],
    steps: [send, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2' } }],
    expect: { requests: [CONFIG_GET, GOAL_POST, GOAL_POST] },
  },
  {
    id: 'private_mode.auto.cache_fresh_at_599999',
    description: 'Still cached 599,999 ms later',
    client: auto,
    responses: [ok(config()), created, created],
    steps: [send, { call: 'advance_clock', args: { ms: 599_999 } }, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2' } }],
    expect: { requests: [CONFIG_GET, GOAL_POST, GOAL_POST] },
  },
  {
    id: 'private_mode.auto.cache_expires',
    description: 'Refetched once 10 minutes have passed, and the new answer applies',
    client: auto,
    responses: [ok(config()), created, ok(config({ private_mode: true }))],
    steps: [
      send,
      { call: 'advance_clock', args: { ms: 600_000 } },
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2', metadata: { a: 1 } }, expect: { error: guardErr('metadata') } },
    ],
    expect: { requests: [CONFIG_GET, GOAL_POST, CONFIG_GET] },
  },
  {
    id: 'private_mode.auto.config_404_fails_closed',
    description: 'Config unavailable (404 from an older backend): the guard is on, warning config_unavailable',
    client: auto,
    responses: [err(404, 'not_found', 'resource_missing', 'Not found.')],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { email: PM } }, expect: { error: guardErr('metadata') } }],
    expect: { requests: [CONFIG_GET], warnings: ['config_unavailable'] },
  },
  {
    id: 'private_mode.auto.config_500_single_attempt',
    description: 'The config request is never retried; an allowed goal is still sent',
    client: { ...auto, max_retries: 3 },
    responses: [srv('internal_error', 500), created],
    steps: [send],
    expect: { requests: [CONFIG_GET, GOAL_POST], warnings: ['config_unavailable'], sleeps_ms: [] },
  },
  {
    id: 'private_mode.auto.config_timeout',
    description: 'A config timeout fails closed too',
    client: { ...auto, timeout_ms: 300 },
    responses: [{ ...ok(config()), delay_ms: 1500 }],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', metadata: { plan: 'gold' } }, expect: { error: guardErr('metadata') } }],
    expect: { requests: [CONFIG_GET], warnings: ['config_unavailable'] },
  },
  {
    id: 'private_mode.auto.negative_cache',
    description: 'After a config failure the SDK waits 60 s before asking again',
    client: auto,
    responses: [srv(), created, created, ok(config()), created],
    steps: [
      send,
      { call: 'advance_clock', args: { ms: 30_000 } },
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2' } },
      { call: 'advance_clock', args: { ms: 30_000 } },
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-3' } },
    ],
    expect: { requests: [CONFIG_GET, GOAL_POST, GOAL_POST, CONFIG_GET, GOAL_POST], warnings: ['config_unavailable'] },
  },
  {
    id: 'private_mode.auto.minimum_version',
    description: 'Below the minimum SDK version: one warning per client',
    client: auto,
    responses: [ok(config({ minimum_sdk_versions: { node: '99.0.0', python: '99.0.0', php: '99.0.0', java: '99.0.0', dotnet: '99.0.0' } })), created, created],
    steps: [send, { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-2' } }],
    expect: { requests: [CONFIG_GET, GOAL_POST, GOAL_POST], warnings: ['sdk_below_minimum_version'] },
  },
  {
    id: 'private_mode.auto.unknown_goal',
    description: 'An unknown goal warns once per key and is still sent',
    client: auto,
    responses: [ok(config()), created, created],
    steps: [{ call: 'goals.send', args: { key: 'mystery_goal', reference: 'M-1' } }, { call: 'goals.send', args: { key: 'mystery_goal', reference: 'M-2' } }],
    expect: { requests: [CONFIG_GET, GOAL_POST, GOAL_POST], warnings: ['unknown_goal'] },
  },
  {
    id: 'private_mode.auto.value_rules',
    description: 'value_not_allowed and value_required warn (the server decides)',
    client: auto,
    responses: [ok(config()), created, created],
    steps: [{ call: 'goals.send', args: { key: 'signup', reference: 'S-1', value: '5' } }, { call: 'goals.send', args: { key: 'loan_disbursed', reference: 'L-1' } }],
    expect: { requests: [CONFIG_GET, GOAL_POST, GOAL_POST], warnings: ['value_not_allowed', 'value_required'] },
  },
  {
    id: 'private_mode.auto.config_call',
    description: 'config() returns the cached config',
    client: auto,
    responses: [ok(config({ click_id_param: 'ref' }))],
    steps: [{ call: 'config.get', expect: { result: { private_mode: false, click_id_param: 'ref', organization_id: { $regex: '^org_' } } } }, { call: 'config.get', expect: { result: { click_id_param: 'ref' } } }],
    expect: { requests: [CONFIG_GET] },
  },
  {
    id: 'private_mode.auto.links_skip_config',
    description: 'Link calls never fetch config',
    client: auto,
    responses: [ok(link(), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: 'https://example.com/spring' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/links' }] },
  },
  {
    id: 'private_mode.auto.background',
    description: 'Background + auto: the sender fetches config before the first batch',
    client: { ...bg, ...auto },
    responses: [ok(config()), batchOk(1)],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'flush' }],
    expect: { requests: [CONFIG_GET, { ...BATCH_POST, json: { events: [ev(0)] } }], on_error: [] },
  },
]);

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// ---------------------------------------------------------------------------------------------
add('links', 'Links: create, get, update (202 change requests, 409 locked), list, QR; clicks (SPEC 11)', [
  {
    id: 'links.create',
    description: 'create posts the params and returns the link with its warnings',
    responses: [ok(link({ warnings: [NO_PREVIEW] }), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: 'https://example.com/spring', slug: 'spring', tags: ['promo'] } }, expect: { result: { id: LINK, warnings: [{ code: 'no_preview' }] } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/links', query: {}, json: { destination_url: 'https://example.com/spring', slug: 'spring', tags: ['promo'] } }] },
  },
  {
    id: 'links.create.test_page_shorthand',
    description: 'Test links: the clikgate-test:<page> shorthand is sent unchanged; the server stores dev.ciz.to and caps expires_at at 30 days',
    responses: [ok(link({ destination_url: 'https://dev.ciz.to/_t/checkout', domain: 'dev.ciz.to', domain_badge: null, expires_at: '2026-11-25T12:00:00Z' }), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: 'clikgate-test:checkout', expires_at: '2027-06-01T00:00:00Z' } }, expect: { result: { domain: 'dev.ciz.to', domain_badge: null, expires_at: '2026-11-25T12:00:00Z' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/links', json: { destination_url: 'clikgate-test:checkout', expires_at: '2027-06-01T00:00:00Z' } }] },
  },
  ...['inspect', 'app-open', 'store'].map((page) => ({
    id: `links.create.test_page_${page}`,
    description: `clikgate-test:${page} is passed through (no local destination validation)`,
    responses: [ok(link({ destination_url: `https://dev.ciz.to/_t/${page}`, domain: 'dev.ciz.to', domain_badge: null }), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: `clikgate-test:${page}` } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/links', json: { destination_url: `clikgate-test:${page}` } }] },
  })),
  {
    id: 'links.create.premium_badge',
    description: 'A paid ciz.to link carries domain_badge "premium"',
    client: { api_key: LIVE_KEY },
    responses: [ok(link({ domain: 'ciz.to', short_url: 'https://ciz.to/spring', domain_badge: 'premium', livemode: true }), 201)],
    steps: [{ call: 'links.create', args: { params: { destination_url: 'https://example.com/spring' } }, expect: { result: { domain: 'ciz.to', domain_badge: 'premium' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/links' }] },
  },
  {
    id: 'links.get',
    description: 'get fetches one link',
    responses: [ok(link())],
    steps: [{ call: 'links.get', args: { id: LINK }, expect: { result: { id: LINK, object: 'link' } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/links/${LINK}`, no_body: true }] },
  },
  {
    id: 'links.update.applied',
    description: '200: applied true with the link',
    responses: [ok(link({ title: 'Summer' }))],
    steps: [{ call: 'links.update', args: { id: LINK, params: { title: 'Summer' } }, expect: { result: { applied: true, link: { title: 'Summer' }, change_request: null, warnings: [] } } }],
    expect: { requests: [{ method: 'PATCH', path: `/v1/links/${LINK}`, json: { title: 'Summer' } }] },
  },
  {
    id: 'links.update.warnings',
    description: "200 with warnings: the result's warnings are the link's",
    responses: [ok(link({ warnings: [NO_PREVIEW] }))],
    steps: [{ call: 'links.update', args: { id: LINK, params: { og_title: null } }, expect: { result: { applied: true, warnings: [{ code: 'no_preview', message: { $any: true } }] } } }],
    expect: { requests: [{ method: 'PATCH', json: { og_title: null } }] },
  },
  {
    id: 'links.update.change_request',
    description: '202: the destination change awaits a second person; applied false with change_request',
    responses: [ok(changeRequest, 202)],
    steps: [
      {
        call: 'links.update',
        args: { id: LINK, params: { destination_url: 'https://example.com/summer' } },
        expect: { result: { applied: false, link: null, change_request: { object: 'link_change_request', id: changeRequest.id, status: 'pending', from_url: 'https://example.com/spring', to_url: 'https://example.com/summer', requested_by_type: 'api_key', decision_note: null }, warnings: [] } },
      },
    ],
    expect: { requests: [{ method: 'PATCH', json: { destination_url: 'https://example.com/summer' } }] },
  },
  {
    id: 'links.update.locked',
    description: '409 link_locked → LinkLockedError, one request',
    responses: [err(409, 'conflict', 'link_locked', 'This link is locked. Unlock it in the dashboard first.', 'destination_url')],
    steps: [{ call: 'links.update', args: { id: LINK, params: { destination_url: 'https://example.com/x' } }, expect: { error: { class: 'LinkLockedError', code: 'link_locked', param: 'destination_url' } } }],
    expect: { requests: [{ method: 'PATCH' }], sleeps_ms: [] },
  },
  {
    id: 'links.update.null_clears',
    description: 'An explicit null in params is sent (PATCH clears the field)',
    responses: [ok(link())],
    steps: [{ call: 'links.update', args: { id: LINK, params: { fallback_url: null, expires_at: null } } }],
    expect: { requests: [{ method: 'PATCH', json: { fallback_url: null, expires_at: null } }] },
  },
  {
    id: 'links.list.paginates',
    description: 'list follows next_cursor with starting_after, keeping the other params',
    responses: [
      ok({ object: 'list', data: [link({ id: 'lnk_1' }), link({ id: 'lnk_2' })], has_more: true, next_cursor: 'lnk_2' }),
      ok({ object: 'list', data: [link({ id: 'lnk_3' })], has_more: false, next_cursor: null }),
    ],
    steps: [{ call: 'links.list', args: { params: { limit: 2, status: 'active' } }, expect: { result: { items: [{ id: 'lnk_1' }, { id: 'lnk_2' }, { id: 'lnk_3' }] } } }],
    expect: {
      requests: [
        { method: 'GET', path: '/v1/links', query: { limit: '2', status: 'active' } },
        { method: 'GET', path: '/v1/links', query: { limit: '2', status: 'active', starting_after: 'lnk_2' } },
      ],
    },
  },
  {
    id: 'links.list.metadata_filter',
    description: 'A metadata map is sent as metadata[<key>]=<value> query parameters (change 10, SPEC section 21)',
    responses: [ok({ object: 'list', data: [link({ id: 'lnk_1', metadata: { seller_id: 'sel_ada' } })], has_more: false, next_cursor: null })],
    steps: [{ call: 'links.list', args: { params: { status: 'active', metadata: { seller_id: 'sel_ada', product_id: 'prd_ankara_6y' } } }, expect: { result: { items: [{ id: 'lnk_1', metadata: { seller_id: 'sel_ada' } }] } } }],
    expect: { requests: [{ method: 'GET', path: '/v1/links', query: { status: 'active', 'metadata[seller_id]': 'sel_ada', 'metadata[product_id]': 'prd_ankara_6y' } }] },
  },
  {
    id: 'links.list.null_cursor_stops',
    description: 'has_more true with a null next_cursor stops',
    responses: [ok({ object: 'list', data: [link({ id: 'lnk_1' })], has_more: true, next_cursor: null })],
    steps: [{ call: 'links.list', args: {}, expect: { result: { items: [{ id: 'lnk_1' }] } } }],
    expect: { requests: [{ method: 'GET', path: '/v1/links', query: {} }] },
  },
  {
    id: 'links.list.lazy',
    description: 'Pages are fetched lazily: taking 1 item makes 1 request',
    responses: [ok({ object: 'list', data: [link({ id: 'lnk_1' }), link({ id: 'lnk_2' })], has_more: true, next_cursor: 'lnk_2' })],
    steps: [{ call: 'links.list', args: { params: { limit: 2 }, max_items: 1 }, expect: { result: { items: [{ id: 'lnk_1' }] } } }],
    expect: { requests: [{ method: 'GET', path: '/v1/links', query: { limit: '2' } }] },
  },
  {
    id: 'links.list_page',
    description: 'list_page returns one page as is',
    responses: [ok({ object: 'list', data: [link({ id: 'lnk_1' })], has_more: true, next_cursor: 'lnk_1' })],
    steps: [{ call: 'links.list_page', args: { params: { tag: 'promo', limit: 1 } }, expect: { result: { object: 'list', has_more: true, next_cursor: 'lnk_1', data: [{ id: 'lnk_1' }] } } }],
    expect: { requests: [{ method: 'GET', path: '/v1/links', query: { tag: 'promo', limit: '1' } }] },
  },
  {
    id: 'links.qr.svg',
    description: 'qr returns bytes and the content type',
    responses: [{ status: 200, headers: { 'content-type': 'image/svg+xml' }, body_text: SVG }],
    steps: [{ call: 'links.qr', args: { id: LINK, format: 'svg', size: 512 }, expect: { result: { content_type: 'image/svg+xml', bytes_length: Buffer.byteLength(SVG) } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/links/${LINK}/qr`, query: { format: 'svg', size: '512' } }] },
  },
  {
    id: 'links.qr.png',
    description: 'Binary bodies are returned unchanged',
    responses: [{ status: 200, headers: { 'content-type': 'image/png' }, body_base64: PNG }],
    steps: [{ call: 'links.qr', args: { id: LINK, format: 'png' }, expect: { result: { content_type: 'image/png', bytes_length: Buffer.from(PNG, 'base64').length } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/links/${LINK}/qr`, query: { format: 'png' } }] },
  },
  {
    id: 'clicks.get',
    description: 'clicks.get fetches one click',
    responses: [ok(click)],
    steps: [{ call: 'clicks.get', args: { id: CLICK }, expect: { result: { id: CLICK, country: 'NG', is_suspected_bot: false } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/clicks/${CLICK}` }] },
  },
  {
    id: 'conversions.create',
    description: 'conversions.create posts the wire params',
    responses: [ok({ object: 'conversion', id: 'cnv_4', status: 'attributed' }, 201)],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'shopify:5512093', click_id: CLICK, type: 'purchase', amount_minor: 5000000, currency: 'NGN' } }, expect: { result: { id: 'cnv_4' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'shopify:5512093', click_id: CLICK, type: 'purchase', amount_minor: 5000000, currency: 'NGN' } }] },
  },
  {
    id: 'conversions.reverse',
    description: 'conversions.reverse posts to /reverse',
    responses: [ok({ object: 'conversion', id: 'cnv_4', status: 'reversed' })],
    steps: [{ call: 'conversions.reverse', args: { id: 'cnv_4', params: { amount_minor: 2000000, reason: 'partial refund' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions/cnv_4/reverse', json: { amount_minor: 2000000, reason: 'partial refund' } }] },
  },
  {
    id: 'conversions.create.payment_goal',
    description: 'Change 12 (B2.5): conversions.create on a Payment goal sends provider and answers with the goal event (object goal_event), returned as is',
    responses: [ok(payGoal({ reference: 'ORD-77', payment: { confirmation_id: PCF, match_status: 'matched', report_id: PRP, provider: 'paystack' } }), 201)],
    steps: [
      {
        call: 'conversions.create',
        args: { params: { external_id: 'ORD-77', goal: 'order_paid', click_id: CLICK, value: '7500', currency: 'NGN', provider: 'paystack' } },
        expect: { result: { object: 'goal_event', status: 'counted', goal_kind: 'payment', counted: true, payment: { provider: 'paystack', match_status: 'matched' } } },
      },
    ],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-77', goal: 'order_paid', click_id: CLICK, value: '7500', currency: 'NGN', provider: 'paystack' } }] },
  },
  {
    id: 'conversions.create.payment_goal_waiting',
    description: 'Change 12 (B2.5): without a click ID the Payment goal conversion waits for its report (status waiting, the confirmation id)',
    responses: [ok({ ...paymentWaiting, reference: 'ORD-78' }, 201)],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-78', goal: 'order_paid', amount_minor: 750000, currency: 'NGN', provider: 'paystack' } }, expect: { result: { object: 'goal_event', id: PCF, status: 'waiting', reason: 'waiting_for_confirmation' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-78', goal: 'order_paid', amount_minor: 750000, currency: 'NGN', provider: 'paystack' } }] },
  },
  {
    id: 'conversions.create.payment_goal_missing_provider',
    description: 'Change 12 (B2.5): a Payment goal conversion without provider → 422 payment_goal_needs_confirmation (not retried)',
    responses: [goalErr(422, 'invalid_request', 'payment_goal_needs_confirmation', 'order_paid is a Payment goal: send provider and reference so your payment provider or server can confirm it.', 'provider', { missing: ['provider'] })],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-79', goal: 'order_paid', value: '10' } }, expect: { error: { class: 'InvalidRequestError', code: 'payment_goal_needs_confirmation', param: 'provider', http_status: 422 } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions' }] },
  },
  {
    id: 'conversions.create.standard_unchanged',
    description: 'Change 12: a conversion for a Standard goal still answers with the conversion object',
    responses: [ok({ object: 'conversion', id: 'cnv_6', status: 'attributed' }, 201)],
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-80', goal: 'account_opened', provider: 'paystack' } }, expect: { result: { object: 'conversion', id: 'cnv_6' } } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-80', goal: 'account_opened', provider: 'paystack' } }] },
  },
  {
    id: 'conversions.reverse.no_params',
    description: 'Without params the body is {}',
    responses: [ok({ object: 'conversion', id: 'cnv_4', status: 'reversed' })],
    steps: [{ call: 'conversions.reverse', args: { id: 'cnv_4' } }],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions/cnv_4/reverse', json: {} }] },
  },
]);

// ---------------------------------------------------------------------------------------------
const SECRET = 'whsec_test_5f2bc1d0a9e84f7b';
const OLD_SECRET = 'whsec_test_old_7a1d33e2c0';
const event = {
  id: 'evt_01JCK8Z9V7Q4M2N6P8R0S2T4EV',
  object: 'event',
  type: 'goal.completed',
  api_version: '2026-10-01',
  created_at: '2026-10-26T12:00:00Z',
  organization_id: 'org_01JCK8Z9V7Q4M2N6P8R0S2T4OR',
  livemode: false,
  data: { object: { object: 'goal_event', id: 'cnv_1', goal: 'account_opened', value: '2000000', currency: 'NGN' }, previous_attributes: null },
};
const BODY = JSON.stringify(event);
const sig = (secret, t, body = BODY) => createHmac('sha256', secret).update(`${t}.`).update(Buffer.from(body, 'utf8')).digest('hex');
const hdr = (t, ...sigs) => [`t=${t}`, ...sigs.map((s) => `v1=${s}`)].join(',');
const wh = (id, description, args, expectation, call = 'webhooks.verify') => ({
  id: `webhooks.${id}`,
  description,
  steps: [{ call, args: { now: NOW_S, tolerance: 300, ...args }, expect: expectation }],
  expect: { requests: [] },
});
const verified = { result: { id: event.id, type: 'goal.completed', data: { object: { goal: 'account_opened' } } } };
const sigErr = (code) => ({ error: { class: 'SignatureVerificationError', code, message_excludes: [SECRET, sig(SECRET, NOW_S)] } });
const UNICODE = JSON.stringify({ ...event, data: { object: { note: 'Ọjà ₦ 東京 😀' } } });
// subscription.updated (backend C10 B2.8): sent when a Growth add-on is activated, set to end at renewal, or kept.
// data.object is the subscription with add_ons[]; data.change is add_on.activated | add_on.remove_at_renewal.
const SUB_EVENT = JSON.stringify({
  id: 'evt_01JCK8Z9V7Q4M2N6P8R0S2T4SU',
  object: 'event',
  type: 'subscription.updated',
  api_version: '2026-10-01',
  created_at: '2026-10-27T09:00:00Z',
  organization_id: 'org_01JCK8Z9V7Q4M2N6P8R0S2T4OR',
  livemode: true,
  data: {
    object: {
      object: 'subscription',
      id: 'sub_01JCK8Z9V7Q4M2N6P8R0S2T4SB',
      plan_key: 'growth',
      add_ons: [{ key: 'domains_pack', name: 'Domains pack', status: 'active', amount_minor: 4000000, ends_at: null, remove_at_renewal: false }],
    },
    previous_attributes: null,
    change: 'add_on.activated',
    add_on_key: 'domains_pack',
  },
});
// link.destination_changed (backend C6-B5, src/links/services/link_change_requests.py): data.object is the link,
// plus from, to, actor {type, id, api_key_prefix, requested_by?, change_request_id?}, actor_type and api_key_prefix
const DEST_EVENT = JSON.stringify({
  id: 'evt_01JCK8Z9V7Q4M2N6P8R0S2T4DC',
  object: 'event',
  type: 'link.destination_changed',
  api_version: '2026-10-01',
  created_at: '2026-10-26T12:05:00Z',
  organization_id: 'org_01JCK8Z9V7Q4M2N6P8R0S2T4OR',
  livemode: true,
  data: {
    object: { object: 'link', id: 'lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA', destination_url: 'https://example.com/summer', locked: false },
    previous_attributes: null,
    from: 'https://example.com/spring',
    to: 'https://example.com/summer',
    actor: { type: 'user', id: 'usr_01JCK8Z9V7Q4M2N6P8R0S2T4US', api_key_prefix: null, requested_by: 'key_01JCK8Z9V7Q4M2N6P8R0S2T4KY', change_request_id: 'lcr_01JCK8Z9V7Q4M2N6P8R0S2T4CR' },
    actor_type: 'user',
    api_key_prefix: null,
  },
});
add('webhooks', 'Webhook signature verification (SPEC 14, backend spec 13.3)', [
  wh('valid', 'A valid signature returns the parsed event', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET, NOW_S)), secret: SECRET }, verified),
  wh('valid.bytes', 'A byte buffer body works the same', { raw_body: { $bytes_base64: Buffer.from(BODY).toString('base64') }, header: hdr(NOW_S, sig(SECRET, NOW_S)), secret: SECRET }, verified),
  wh('valid.unicode', 'Multi-byte UTF-8 is signed over its bytes', { raw_body: UNICODE, header: hdr(NOW_S, sig(SECRET, NOW_S, UNICODE)), secret: SECRET }, { result: { id: event.id, data: { object: { note: 'Ọjà ₦ 東京 😀' } } } }),
  wh('valid.whitespace', 'Spaces around parts are trimmed', { raw_body: BODY, header: ` t=${NOW_S} ,  v1=${sig(SECRET, NOW_S)} `, secret: SECRET }, verified),
  wh('valid.rotation_second', 'During rotation the header has two v1 values (new first); the old secret matches the second', { raw_body: BODY, header: hdr(NOW_S, sig('whsec_new_rotated_9', NOW_S), sig(SECRET, NOW_S)), secret: SECRET }, verified),
  wh('valid.v0_ignored', 'Unknown schemes are ignored', { raw_body: BODY, header: `t=${NOW_S},v0=deadbeef,v1=${sig(SECRET, NOW_S)}`, secret: SECRET }, verified),
  wh('valid.edge_of_tolerance', 'Exactly 300 s old is accepted', { raw_body: BODY, header: hdr(NOW_S - 300, sig(SECRET, NOW_S - 300)), secret: SECRET }, verified),
  wh('valid.tolerance_zero', 'tolerance 0 disables the time check (tests only)', { raw_body: BODY, header: hdr(NOW_S - 86400, sig(SECRET, NOW_S - 86400)), secret: SECRET, tolerance: 0 }, verified),
  wh('valid.custom_tolerance', 'A custom tolerance of 600 s accepts 500 s old', { raw_body: BODY, header: hdr(NOW_S - 500, sig(SECRET, NOW_S - 500)), secret: SECRET, tolerance: 600 }, verified),
  wh('valid.subscription_updated', 'subscription.updated (change 10) carries the subscription with add_ons, change and add_on_key', { raw_body: SUB_EVENT, header: hdr(NOW_S, sig(SECRET, NOW_S, SUB_EVENT)), secret: SECRET }, { result: { type: 'subscription.updated', data: { object: { object: 'subscription', plan_key: 'growth', add_ons: [{ key: 'domains_pack', status: 'active', amount_minor: 4000000, remove_at_renewal: false }] }, change: 'add_on.activated', add_on_key: 'domains_pack' } } }),
  wh('valid.link_destination_changed', 'link.destination_changed carries the link, from, to and the actor', { raw_body: DEST_EVENT, header: hdr(NOW_S, sig(SECRET, NOW_S, DEST_EVENT)), secret: SECRET }, { result: { type: 'link.destination_changed', data: { object: { object: 'link' }, from: 'https://example.com/spring', to: 'https://example.com/summer', actor: { type: 'user', change_request_id: 'lcr_01JCK8Z9V7Q4M2N6P8R0S2T4CR' }, actor_type: 'user' } } }),
  wh('expired', '301 s old is refused', { raw_body: BODY, header: hdr(NOW_S - 301, sig(SECRET, NOW_S - 301)), secret: SECRET }, sigErr('timestamp_outside_tolerance')),
  wh('future', '301 s in the future is refused', { raw_body: BODY, header: hdr(NOW_S + 301, sig(SECRET, NOW_S + 301)), secret: SECRET }, sigErr('timestamp_outside_tolerance')),
  wh('tampered', 'A changed body fails', { raw_body: BODY.replace('2000000', '9000000'), header: hdr(NOW_S, sig(SECRET, NOW_S)), secret: SECRET }, sigErr('no_matching_signature')),
  wh('tampered_timestamp', 'A changed timestamp fails', { raw_body: BODY, header: hdr(NOW_S - 1, sig(SECRET, NOW_S)), secret: SECRET }, sigErr('no_matching_signature')),
  wh('wrong_secret', 'The wrong secret fails', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET, NOW_S)), secret: 'whsec_wrong' }, sigErr('no_matching_signature')),
  wh('secret_without_prefix', 'The key is the whole secret including whsec_', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET.slice(6), NOW_S)), secret: SECRET }, sigErr('no_matching_signature')),
  wh('uppercase_hex', 'Signatures are lowercase hex; uppercase does not match', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET, NOW_S).toUpperCase()), secret: SECRET }, sigErr('no_matching_signature')),
  wh('short_signature', 'A truncated signature is a mismatch, not a crash', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET, NOW_S).slice(0, 20)), secret: SECRET }, sigErr('no_matching_signature')),
  wh('missing_header', 'An empty header', { raw_body: BODY, header: '', secret: SECRET }, sigErr('missing_signature')),
  wh('missing_header_null', 'A missing (null) header', { raw_body: BODY, header: null, secret: SECRET }, sigErr('missing_signature')),
  wh('no_v1', 'No v1 value', { raw_body: BODY, header: `t=${NOW_S}`, secret: SECRET }, sigErr('malformed_signature')),
  wh('no_t', 'No timestamp', { raw_body: BODY, header: `v1=${sig(SECRET, NOW_S)}`, secret: SECRET }, sigErr('malformed_signature')),
  wh('bad_t', 'A non-numeric timestamp', { raw_body: BODY, header: `t=abc,v1=${sig(SECRET, NOW_S)}`, secret: SECRET }, sigErr('malformed_signature')),
  wh('only_v0', 'Only an unknown scheme', { raw_body: BODY, header: `t=${NOW_S},v0=${sig(SECRET, NOW_S)}`, secret: SECRET }, sigErr('malformed_signature')),
  wh('not_json', 'A correctly signed body that is not JSON', { raw_body: 'hello', header: hdr(NOW_S, sig(SECRET, NOW_S, 'hello')), secret: SECRET }, sigErr('invalid_payload')),
  wh('json_array', 'A correctly signed JSON array is not an event', { raw_body: '[1,2]', header: hdr(NOW_S, sig(SECRET, NOW_S, '[1,2]')), secret: SECRET }, sigErr('invalid_payload')),
  wh('any.second_secret', 'verify_any: the second secret matches', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET, NOW_S)), secrets: [OLD_SECRET, SECRET] }, verified, 'webhooks.verify_any'),
  wh('any.first_secret', 'verify_any: the first secret matches the second v1', { raw_body: BODY, header: hdr(NOW_S, sig('whsec_other', NOW_S), sig(OLD_SECRET, NOW_S)), secrets: [OLD_SECRET, SECRET] }, verified, 'webhooks.verify_any'),
  wh('any.none', 'verify_any: no secret matches', { raw_body: BODY, header: hdr(NOW_S, sig('whsec_other', NOW_S)), secrets: [OLD_SECRET, SECRET] }, sigErr('no_matching_signature'), 'webhooks.verify_any'),
  wh('any.expired', 'verify_any still checks the timestamp', { raw_body: BODY, header: hdr(NOW_S - 400, sig(SECRET, NOW_S - 400)), secrets: [SECRET] }, sigErr('timestamp_outside_tolerance'), 'webhooks.verify_any'),
  wh('any.empty', 'verify_any with no secrets is an argument error', { raw_body: BODY, header: hdr(NOW_S, sig(SECRET, NOW_S)), secrets: [] }, { error: { class: 'InvalidRequestError', code: 'invalid_argument' } }, 'webhooks.verify_any'),
]);

// ---------------------------------------------------------------------------------------------
const req = (url, headers = {}) => ({ request: { url, headers } });
const fr = (id, description, request, value, { pre = [], requests = [], ...extra } = {}) => ({
  id: `click_ids.from_request.${id}`,
  description,
  ...extra,
  steps: [...pre, { call: 'click_ids.from_request', args: request, expect: { result: { value } } }],
  expect: { requests },
});
const pm = (id, description, payload, value) => ({
  id: `click_ids.payment_metadata.${id}`,
  description,
  steps: [{ call: 'click_ids.from_payment_metadata', args: { payload }, expect: { result: { value } } }],
  expect: { requests: [] },
});
const ch = (id, description, args, value, client = {}) => ({
  id: `click_ids.cookie_header.${id}`,
  description,
  client,
  steps: [{ call: 'click_ids.cookie_header', args, expect: typeof value === 'string' ? { result: { value } } : value }],
  expect: { requests: [] },
});
const iv = (id, value, expected) => ({
  id: `click_ids.is_valid.${id}`,
  description: `is_valid(${JSON.stringify(value)}) is ${expected}`,
  steps: [{ call: 'click_ids.is_valid', args: { id: value }, expect: { result: { value: expected } } }],
  expect: { requests: [] },
});
// Change 16 (R.1): click_ids.keep, the /cg/keep route on the business's own server
const KEEP_URL = 'https://shop.example.com/cg/keep';
const KEEP_NO_STORE = 'no-store, private';
const keepReq = (headers, body, method = 'POST', url = KEEP_URL) => ({ method, url, headers: { host: 'shop.example.com', ...headers }, body });
const keepBody = (clickId, pageClickId = clickId) => JSON.stringify({ click_id: clickId, page_click_id: pageClickId });
const SAME = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const kept = (id, days = 30, param = 'cgid') => [
  `_cg_${param}=${id}; Path=/; Max-Age=${days * 86400}; SameSite=Lax; Secure`,
  `_cg_kept=s; Path=/; Max-Age=${days * 86400}; SameSite=Lax; Secure`,
];
const keep = (id, description, request, status, setCookie, { options = {}, client = {}, extraHeaders } = {}) => ({
  id: `click_ids.keep.${id}`,
  description,
  client,
  steps: [{
    call: 'click_ids.keep',
    args: { request, ...options },
    expect: {
      exact: true,
      result: { status, cache_control: KEEP_NO_STORE, set_cookie: setCookie, body: '', location: null, ...(extraHeaders ?? {}) },
    },
  }],
  expect: { requests: [] },
});
function keepCases() {
  return [
    keep('same_origin', 'Sec-Fetch-Site same-origin, matching IDs: 204 with the cookie and the marker', keepReq(SAME, keepBody(CLICK)), 204, kept(CLICK)),
    keep('origin_matches_host', 'No Sec-Fetch-Site; an Origin matching Host is accepted', keepReq({ origin: 'https://shop.example.com', 'content-type': 'application/json' }, keepBody(CLICK)), 204, kept(CLICK)),
    keep('header_case', 'Header names in any case', keepReq({ 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, keepBody(CLICK)), 204, kept(CLICK)),
    keep('cross_site', 'Sec-Fetch-Site cross-site is refused (403), nothing set', keepReq({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example.net' }, keepBody(CLICK)), 403, []),
    keep('same_site_subdomain', 'Sec-Fetch-Site same-site (another subdomain) is refused', keepReq({ 'sec-fetch-site': 'same-site', origin: 'https://blog.example.com' }, keepBody(CLICK)), 403, []),
    keep('cross_site_even_with_matching_origin', 'A Sec-Fetch-Site other than same-origin wins over the Origin', keepReq({ 'sec-fetch-site': 'cross-site', origin: 'https://shop.example.com' }, keepBody(CLICK)), 403, []),
    keep('origin_mismatch', 'An Origin for another host is refused', keepReq({ origin: 'https://evil.example.net' }, keepBody(CLICK)), 403, []),
    keep('origin_other_port', 'An Origin with another port is refused', keepReq({ origin: 'https://shop.example.com:8443' }, keepBody(CLICK)), 403, []),
    keep('no_origin', 'Neither Sec-Fetch-Site nor Origin: refused', keepReq({ 'content-type': 'application/json' }, keepBody(CLICK)), 403, []),
    keep('origin_null', 'Origin "null" is refused', keepReq({ origin: 'null' }, keepBody(CLICK)), 403, []),
    keep('get', 'GET is refused (405, Allow: POST); the query is never read', keepReq(SAME, '', 'GET', `${KEEP_URL}?click_id=${CLICK}&page_click_id=${CLICK}`), 405, [], { extraHeaders: { allow: 'POST' } }),
    keep('mismatch', 'The click ID must equal the page URL click ID (400)', keepReq(SAME, keepBody(CLICK, CLICK2)), 400, []),
    keep('page_missing', 'Without page_click_id: 400', keepReq(SAME, JSON.stringify({ click_id: CLICK })), 400, []),
    keep('invalid', 'An invalid click ID: 400', keepReq(SAME, keepBody('clk_bad')), 400, []),
    keep('lowercase', 'A lowercase click ID: 400', keepReq(SAME, keepBody(CLICK.toLowerCase())), 400, []),
    keep('script_in_value', 'Markup in the value is refused and never echoed', keepReq(SAME, keepBody('<script>alert(1)</script>')), 400, []),
    keep('not_json', 'A body that is not JSON: 400', keepReq(SAME, 'click_id=' + CLICK), 400, []),
    keep('array_body', 'A JSON array body: 400', keepReq(SAME, '[]'), 400, []),
    keep('too_large', 'A body over 1 KB: 400', keepReq(SAME, JSON.stringify({ click_id: CLICK, page_click_id: CLICK, pad: 'x'.repeat(1100) })), 400, []),
    keep('name_from_config', 'A cookie name sent in the request is ignored; the name comes from configuration', keepReq(SAME, JSON.stringify({ click_id: CLICK, page_click_id: CLICK, name: 'session', param: 'evil', cookie: 'x' })), 204, kept(CLICK)),
    keep('custom_param', 'click_id_param "ref": the cookie is _cg_ref', keepReq(SAME, keepBody(CLICK)), 204, kept(CLICK, 30, 'ref'), { client: { click_id_param: 'ref' } }),
    keep('days', 'days 90: Max-Age 7776000 on both cookies', keepReq(SAME, keepBody(CLICK)), 204, kept(CLICK, 90), { options: { days: 90 } }),
  ];
}

const UA_IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1';
const UA_IPAD_SAFARI = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const UA_MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const UA_MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const UA_ANDROID_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36';
const UA_WIN_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';
const UA_WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
const UA_LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0';
const ctx = (id, description, request, result, client = {}) => ({
  id: `click_ids.context.${id}`,
  description,
  client,
  steps: [{ call: 'click_ids.context', args: { request }, expect: { exact: true, result } }],
  expect: { requests: [] },
});
function contextCases() {
  const r = (headers, url = 'https://shop.example.com/checkout') => ({ url, headers });
  return [
    ctx('server_cookie', 'Cookie plus the _cg_kept=s marker: server_cookie; iPhone Chrome is webkit_ios', r({ cookie: `_cg_cgid=${CLICK}; _cg_kept=s`, 'user-agent': UA_IPHONE_CHROME }), { click_id: CLICK, kept_by: 'server_cookie', browser_engine: 'webkit_ios', platform: 'ios' }),
    ctx('script_cookie', 'Cookie without the marker: script_cookie; Mac Safari', r({ cookie: `_cg_cgid=${CLICK}`, 'user-agent': UA_MAC_SAFARI }), { click_id: CLICK, kept_by: 'script_cookie', browser_engine: 'safari_mac', platform: 'macos' }),
    ctx('marker_other_value', 'A marker other than "s" does not count', r({ cookie: `_cg_cgid=${CLICK}; _cg_kept=x`, 'user-agent': UA_MAC_CHROME }), { click_id: CLICK, kept_by: 'script_cookie', browser_engine: 'chromium', platform: 'macos' }),
    ctx('header_is_form', 'The Clikgate-Click-Id header (a form or app field): form', r({ 'clikgate-click-id': CLICK, 'user-agent': UA_WIN_FIREFOX }), { click_id: CLICK, kept_by: 'form', browser_engine: 'gecko', platform: 'windows' }),
    ctx('query_not_kept', 'From the URL: not kept yet (kept_by null)', r({ 'user-agent': UA_ANDROID_SAMSUNG }, `https://shop.example.com/?cgid=${CLICK}`), { click_id: CLICK, kept_by: null, browser_engine: 'chromium', platform: 'android' }),
    ctx('none', 'No click ID: nulls; iPad Safari', r({ 'user-agent': UA_IPAD_SAFARI }), { click_id: null, kept_by: null, browser_engine: 'webkit_ios', platform: 'ios' }),
    ctx('edge_windows', 'Edge on Windows: chromium', r({ 'user-agent': UA_WIN_EDGE }), { click_id: null, kept_by: null, browser_engine: 'chromium', platform: 'windows' }),
    ctx('linux_firefox', 'Firefox on Linux: gecko', r({ 'user-agent': UA_LINUX_FIREFOX }), { click_id: null, kept_by: null, browser_engine: 'gecko', platform: 'linux' }),
    ctx('no_user_agent', 'No User-Agent: other/other', r({}), { click_id: null, kept_by: null, browser_engine: 'other', platform: 'other' }),
    ctx('custom_param', 'click_id_param "ref": _cg_ref and the marker', r({ cookie: `_cg_ref=${CLICK}; _cg_kept=s`, 'user-agent': UA_MAC_SAFARI }), { click_id: CLICK, kept_by: 'server_cookie', browser_engine: 'safari_mac', platform: 'macos' }, { click_id_param: 'ref' }),
  ];
}

add('click_ids', 'Keeping the click ID: validation, extraction, cookies, payment metadata (SPEC 13)', [
  iv('valid', CLICK, true),
  iv('lowercase', CLICK.toLowerCase(), false),
  iv('wrong_prefix', CLICK.replace('clk_', 'lnk_'), false),
  iv('short', CLICK.slice(0, -1), false),
  iv('long', `${CLICK}X`, false),
  iv('whitespace', ` ${CLICK}`, false),
  iv('any_uppercase_letter', `${CLICK.slice(0, -1)}U`, true),
  iv('symbol', `${CLICK.slice(0, -1)}-`, false),
  iv('number', 123, false),
  iv('null', null, false),
  fr('query', 'The query parameter cgid', req(`https://shop.example.com/landing?utm_source=x&cgid=${CLICK}`), CLICK),
  fr('query_invalid_falls_to_cookie', 'An invalid query value is skipped; the cookie is used', req('https://shop.example.com/?cgid=garbage', { cookie: `a=1; _cg_cgid=${CLICK2}; b=2` }), CLICK2),
  fr('cookie', 'The _cg_cgid cookie', req('https://shop.example.com/', { cookie: `_cg_cgid=${CLICK}` }), CLICK),
  fr('cookie_encoded', 'Cookie values are URL-decoded', req('https://shop.example.com/', { cookie: `_cg_cgid=${encodeURIComponent(CLICK).replace('_', '%5F')}` }), CLICK),
  fr('header', 'The Clikgate-Click-Id header', req('https://api.example.com/signup', { 'Clikgate-Click-Id': CLICK }), CLICK),
  fr('header_case_and_space', 'The header name is case-insensitive and the value trimmed', req('https://api.example.com/signup', { 'clikgate-click-id': `  ${CLICK} ` }), CLICK),
  fr('precedence', 'Query wins over cookie, cookie over header', req(`https://shop.example.com/?cgid=${CLICK}`, { cookie: `_cg_cgid=${CLICK2}`, 'Clikgate-Click-Id': CLICK2 }), CLICK),
  fr('cookie_over_header', 'Cookie wins over header', req('https://shop.example.com/', { cookie: `_cg_cgid=${CLICK}`, 'Clikgate-Click-Id': CLICK2 }), CLICK),
  fr('repeated_query', 'The first valid occurrence of a repeated parameter', req(`https://shop.example.com/?cgid=bad&cgid=${CLICK2}`), CLICK2),
  fr('none', 'Nothing present → null', req('https://shop.example.com/?utm_source=x'), null),
  fr('all_invalid', 'Only invalid values → null', req('https://shop.example.com/?cgid=clk_bad', { cookie: '_cg_cgid=nope', 'Clikgate-Click-Id': 'nope' }), null),
  fr('path_only', 'A path without host is accepted', req(`/landing?cgid=${CLICK}`), CLICK),
  fr('custom_param', 'click_id_param "ref": query ref and cookie _cg_ref', req(`https://shop.example.com/?cgid=${CLICK2}&ref=${CLICK}`), CLICK, { client: { click_id_param: 'ref' } }),
  fr('custom_param_cookie', 'click_id_param "ref" reads _cg_ref, not _cg_cgid', req('https://shop.example.com/', { cookie: `_cg_cgid=${CLICK2}; _cg_ref=${CLICK}` }), CLICK, { client: { click_id_param: 'ref' } }),
  fr('custom_param_ignores_cgid', 'With click_id_param "ref", cgid is not read', req(`https://shop.example.com/?cgid=${CLICK}`), null, { client: { click_id_param: 'ref' } }),
  fr('param_from_config', 'auto mode: after config loads, its click_id_param is used', req(`https://shop.example.com/?dcid=${CLICK}`), CLICK, {
    client: auto,
    responses: [ok(config({ click_id_param: 'dcid' }))],
    pre: [{ call: 'config.get' }],
    requests: [CONFIG_GET],
  }),
  ch('default', 'Default: 30 days, Secure, SameSite=Lax, not HttpOnly', { id: CLICK, secure: true }, `_cg_cgid=${CLICK}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`),
  ch('days_insecure', '7 days over plain HTTP (local development)', { id: CLICK, days: 7, secure: false }, `_cg_cgid=${CLICK}; Path=/; Max-Age=604800; SameSite=Lax`),
  ch('domain', 'With a domain', { id: CLICK, secure: true, domain: '.example.com' }, `_cg_cgid=${CLICK}; Path=/; Max-Age=2592000; Domain=.example.com; SameSite=Lax; Secure`),
  ch('custom_param', 'The cookie name follows click_id_param', { id: CLICK, secure: true }, `_cg_ref=${CLICK}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`, { click_id_param: 'ref' }),
  ch('invalid', 'An invalid ID is refused', { id: 'clk_nope', secure: true }, { error: { class: 'InvalidRequestError', code: 'invalid_click_id' } }),
  {
    id: 'click_ids.persist.keeps_existing',
    description: 'persist appends Set-Cookie and keeps existing ones',
    steps: [{ call: 'click_ids.persist', args: { id: CLICK, secure: true, existing_set_cookie: ['session=abc; Path=/; HttpOnly'] }, expect: { result: { set_cookie: ['session=abc; Path=/; HttpOnly', `_cg_cgid=${CLICK}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`, '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure'] } } }],
    expect: { requests: [] },
  },
  {
    id: 'click_ids.persist.marker_days',
    description: 'persist (change 16): the _cg_kept=s marker follows days, domain and secure',
    steps: [{ call: 'click_ids.persist', args: { id: CLICK, days: 90, secure: false, domain: '.example.com', existing_set_cookie: [] }, expect: { result: { set_cookie: [`_cg_cgid=${CLICK}; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax`, '_cg_kept=s; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax'] } } }],
    expect: { requests: [] },
  },
  ...keepCases(),
  ...contextCases(),
  pm('paystack_object', 'Paystack charge.success: data.metadata object', { event: 'charge.success', data: { reference: 'T1', metadata: { cg_click_id: CLICK } } }, CLICK),
  pm('paystack_string', 'Paystack metadata as a JSON string', { event: 'charge.success', data: { reference: 'T1', metadata: JSON.stringify({ cg_click_id: CLICK }) } }, CLICK),
  pm('paystack_custom_fields', 'Paystack custom_fields (variable_name/value)', { data: { metadata: { custom_fields: [{ display_name: 'Ref', variable_name: 'cg_click_id', value: CLICK }] } } }, CLICK),
  pm('paystack_transaction_object', 'A Paystack transaction object (no envelope)', { reference: 'T1', metadata: { cg_click_id: CLICK } }, CLICK),
  pm('flutterwave_meta', 'Flutterwave charge.completed: data.meta', { event: 'charge.completed', data: { tx_ref: 'F1', meta: { cg_click_id: CLICK } } }, CLICK),
  pm('flutterwave_meta_data', 'Flutterwave meta_data', { data: { tx_ref: 'F1', meta_data: { cgid: CLICK } } }, CLICK),
  pm('shopify_note_attributes', 'Shopify note_attributes (name/value)', { id: 5512093, note_attributes: [{ name: 'gift', value: 'no' }, { name: 'cg_click_id', value: CLICK }] }, CLICK),
  pm('shopify_custom_attributes', 'Shopify GraphQL customAttributes (key/value)', { customAttributes: [{ key: 'cg_click_id', value: CLICK }] }, CLICK),
  pm('woocommerce_meta_data', 'WooCommerce order meta_data (key/value)', { id: 77, meta_data: [{ id: 1, key: '_billing_x', value: 'y' }, { id: 2, key: 'cg_click_id', value: CLICK }] }, CLICK),
  pm('top_level', 'A custom webhook with cg_click_id at the top level', { cg_click_id: CLICK, amount: 1000 }, CLICK),
  pm('clikgate_click_id', 'The clikgate_click_id key', { metadata: { clikgate_click_id: CLICK } }, CLICK),
  pm('key_precedence', 'cg_click_id wins over cgid in the same container', { metadata: { cgid: CLICK2, cg_click_id: CLICK } }, CLICK),
  pm('candidate_precedence', 'The payload is checked before payload.data', { cg_click_id: CLICK, data: { metadata: { cg_click_id: CLICK2 } } }, CLICK),
  pm('invalid_skipped', 'An invalid value is skipped for the next valid one', { metadata: { cg_click_id: 'clk_bad', cgid: CLICK } }, CLICK),
  pm('json_string_payload', 'The payload itself as a JSON string', JSON.stringify({ data: { metadata: { cg_click_id: CLICK } } }), CLICK),
  pm('not_json', 'A non-JSON string → null', 'not json', null),
  pm('nothing', 'No click ID → null', { data: { metadata: { order: 1 } } }, null),
]);

// ---------------------------------------------------------------------------------------------
// Change 11 (S.3): payments.confirm and the gateway helpers (SPEC 22, backend contract B2.2 / B2.3).
// The helper vectors are a copy of clikgate_api/docs/payment-helper-vectors.json (../vectors/).
const VECTORS = JSON.parse(readFileSync(join(here, '..', 'vectors', 'payment-helper-vectors.json'), 'utf8'));
// --check also fails when the copy drifts from the backend's file (when clikgate_api is checked out next to clikgate_sdks).
const BACKEND_VECTORS = join(here, '..', '..', '..', '..', 'clikgate_api', 'docs', 'payment-helper-vectors.json');
if (check && existsSync(BACKEND_VECTORS) && readFileSync(BACKEND_VECTORS, 'utf8') !== readFileSync(join(here, '..', 'vectors', 'payment-helper-vectors.json'), 'utf8')) {
  console.error(`server/conformance/vectors/payment-helper-vectors.json differs from ${BACKEND_VECTORS}: copy it over and rebuild the cases.`);
  process.exit(1);
}
const CONFIRM_POST = { method: 'POST', path: '/v1/payments/confirmations' };
const confirmation = (over = {}) => ({
  object: 'payment_confirmation',
  id: 'pcf_01JCK8Z9V7Q4M2N6P8R0S2T4PC',
  provider: 'paystack',
  reference: 'T_ref_001',
  status: 'success',
  amount: '7500',
  amount_minor: 750000,
  currency: 'NGN',
  occurred_at: '2026-10-28T10:00:00Z',
  route: 'server_verified',
  connection_id: null,
  match_status: 'matched',
  report_id: 'prp_01JCK8Z9V7Q4M2N6P8R0S2T4PR',
  goal_event_id: 'cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE',
  source_plugin: null,
  order_id: null,
  test: true,
  received_at: '2026-10-28T10:00:01Z',
  duplicate: false,
  ...over,
});
const confirmed = (over = {}) => ok(confirmation(over));
const payErr = (code, param = null) => ({ error: { class: 'InvalidRequestError', code, param, http_status: null } });
const HELPER_CALL = { fromPaystack: 'paystack', fromFlutterwave: 'flutterwave', fromMonnify: 'monnify', fromStripe: 'stripe' };
// The wire body a helper sends for a vector: null fields and empty aliases are omitted; `test` comes from
// Paystack `domain` and Stripe `livemode` (helper_rules in the vectors file).
const helperBody = (v) => {
  const body = {};
  for (const [k, val] of Object.entries(v.expected)) {
    if (val === null || (Array.isArray(val) && val.length === 0)) continue;
    body[k] = val;
  }
  const d = v.input.data ?? v.input;
  if (v.helper === 'fromPaystack' && typeof d.domain === 'string') body.test = d.domain === 'test';
  if (v.helper === 'fromStripe' && typeof v.input.livemode === 'boolean') body.test = !v.input.livemode;
  return body;
};
// A minimal verify response carrying one amount vector.
const amountInput = (a) => {
  if (a.provider === 'paystack') return { status: true, data: { reference: 'T_amt', status: 'success', amount: a.input_amount, currency: a.currency } };
  if (a.provider === 'flutterwave') return { status: 'success', data: { tx_ref: 'F_amt', status: 'successful', amount: a.input_amount, currency: a.currency } };
  if (a.provider === 'monnify') return { requestSuccessful: true, responseBody: { paymentReference: 'M_amt', paymentStatus: 'PAID', amountPaid: a.input_amount, currency: a.currency } };
  return { id: 'pi_amt', object: 'payment_intent', status: 'succeeded', amount: a.input_amount, amount_received: a.input_amount, currency: a.currency };
};
const amountRef = { paystack: 'T_amt', flutterwave: 'F_amt', monnify: 'M_amt', stripe: 'pi_amt' };
const build = (id, description, gateway, response, value, extra = {}) => ({
  id: `payments.build.${id}`,
  description,
  steps: [{ call: 'payments.build', args: { gateway, response, ...extra }, expect: { result: { value }, exact: true } }],
  expect: { requests: [] },
});
const ps = (data) => ({ status: true, data: { reference: 'T_1', amount: 500000, currency: 'NGN', ...data } });
const fw = (data) => ({ status: 'success', data: { tx_ref: 'F_1', amount: 100, currency: 'NGN', ...data } });
const mn = (body) => ({ requestSuccessful: true, responseBody: { paymentReference: 'M_1', amountPaid: '100.00', currency: 'NGN', ...body } });
const pi = (over) => ({ id: 'pi_1', object: 'payment_intent', amount: 2000, amount_received: 2000, currency: 'usd', status: 'succeeded', ...over });
const cs = (over) => ({ id: 'cs_test_1', object: 'checkout.session', amount_total: 2000, currency: 'usd', payment_status: 'paid', status: 'complete', payment_intent: 'pi_1', ...over });
const body = (provider, reference, status, over = {}) => ({ provider, reference, status, ...over });
const paystackVector = VECTORS.helpers.find((v) => v.helper === 'fromPaystack');
const stripeVector = VECTORS.helpers.find((v) => v.helper === 'fromStripe');

add('payments', 'Payments confirmed by the business server: payments.confirm and the gateway helpers (SPEC 22; backend C11 B2.2, B2.3)', [
  // payments.confirm ---------------------------------------------------------------------------
  {
    id: 'payments.confirm.full',
    description: 'Every B2.2 field maps to the wire; the confirmation object is returned',
    responses: [confirmed()],
    steps: [
      {
        call: 'payments.confirm',
        args: { provider: 'paystack', reference: 'T_ref_001', status: 'success', amount: '7500.00', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z', aliases: ['T_alias_1'], click_id: CLICK, goal: 'order_paid', test: true },
        expect: { result: { object: 'payment_confirmation', match_status: 'matched', duplicate: false, amount_minor: 750000 } },
      },
    ],
    expect: {
      requests: [
        {
          ...CONFIRM_POST,
          query: {},
          headers: { 'idempotency-key': { $uuid4: true } },
          json: { provider: 'paystack', reference: 'T_ref_001', status: 'success', amount: '7500.00', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z', aliases: ['T_alias_1'], click_id: CLICK, goal: 'order_paid', test: true },
        },
      ],
    },
  },
  {
    id: 'payments.confirm.minimal_pending',
    description: 'pending and failed may omit amount and currency; unset options are omitted',
    responses: [confirmed({ status: 'pending', amount: null, amount_minor: null, currency: null, match_status: 'waiting_for_report' })],
    steps: [{ call: 'payments.confirm', args: { provider: 'flutterwave', reference: 'F_1', status: 'pending', goal: null, aliases: null } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'flutterwave', reference: 'F_1', status: 'pending' } }] },
  },
  {
    id: 'payments.confirm.amount_minor',
    description: 'amount_minor is sent as an integer instead of amount',
    responses: [confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_2', status: 'success', amount_minor: 750000, currency: 'NGN' } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'paystack', reference: 'T_2', status: 'success', amount_minor: 750000, currency: 'NGN' } }] },
  },
  {
    id: 'payments.confirm.amount_decimal',
    description: 'A native decimal amount keeps its scale (SPEC 8)',
    responses: [confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_3', status: 'success', amount: { $decimal: '1500.50' }, currency: 'NGN' } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'paystack', reference: 'T_3', status: 'success', amount: '1500.50', currency: 'NGN' } }] },
  },
  {
    id: 'payments.confirm.amount_integer',
    description: 'An integer amount is sent as its digits, in a string',
    responses: [confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'stripe', reference: 'pi_4', status: 'refunded', amount: 20, currency: 'usd' } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'stripe', reference: 'pi_4', status: 'refunded', amount: '20', currency: 'usd' } }] },
  },
  {
    id: 'payments.confirm.occurred_at_datetime',
    description: 'A native datetime is sent as RFC 3339 UTC',
    responses: [confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_5', status: 'success', amount: '10', currency: 'NGN', occurred_at: { $datetime: '2026-10-28T10:00:00Z' } } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'paystack', reference: 'T_5', status: 'success', amount: '10', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z' } }] },
  },
  {
    id: 'payments.confirm.duplicate',
    description: 'A repeat answers 200 with duplicate true: success, not an error',
    responses: [confirmed({ duplicate: true })],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_ref_001', status: 'success', amount: '7500', currency: 'NGN' }, expect: { result: { duplicate: true } } }],
    expect: { requests: [CONFIRM_POST] },
  },
  {
    id: 'payments.confirm.retry_same_key',
    description: 'A 503 is retried with the same Idempotency-Key and body',
    responses: [srv(), confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_6', status: 'success', amount: '50', currency: 'NGN' }, expect: { result: { object: 'payment_confirmation' } } }],
    expect: { requests: [{ ...CONFIRM_POST, headers: { 'idempotency-key': { $uuid4: true } } }, { ...CONFIRM_POST, idempotency_key_same_as: 0 }], sleeps_ms: [250] },
  },
  {
    id: 'payments.confirm.idempotency_key',
    description: 'A caller-supplied Idempotency-Key is used as given',
    responses: [confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_7', status: 'success', amount: '50', currency: 'NGN', idempotency_key: 'pay-T_7' } }],
    expect: { requests: [{ ...CONFIRM_POST, headers: { 'idempotency-key': 'pay-T_7' } }] },
  },
  {
    id: 'payments.confirm.server_422',
    description: 'A 422 from the API is an InvalidRequestError with its code and param, not retried',
    responses: [err(422, 'invalid_request', 'environment_mismatch', 'This is a test payment and the key is live.', 'test')],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_8', status: 'success', amount: '50', currency: 'NGN', test: true }, expect: { error: { class: 'InvalidRequestError', code: 'environment_mismatch', param: 'test', http_status: 422 } } }],
    expect: { requests: [CONFIRM_POST] },
  },
  {
    id: 'payments.confirm.plan_feature_unavailable',
    description: 'Change 12 (backend C12 V1.6): payments need Starter or above; Free gets 403 plan_feature_unavailable, a PermissionError with required_plan',
    responses: [err(403, 'permission', 'plan_feature_unavailable', "You're on Free. Payment goals are included from Starter. Upgrade to Starter to use them.", null, 'req_01JCK8Z9V7Q4M2N6P8R0S2T4RQ', { feature: 'payment_goals', required_plan: 'starter' })],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_9', status: 'success', amount: '50', currency: 'NGN' }, expect: { error: { class: 'PermissionError', code: 'plan_feature_unavailable', http_status: 403, required_plan: 'starter' } } }],
    expect: { requests: [CONFIRM_POST] },
  },
  {
    id: 'payments.confirm.unknown_provider',
    description: 'Change 12: a well-formed provider this SDK does not know is sent; the API answers 422 unknown_provider (not retried)',
    responses: [err(422, 'invalid_request', 'unknown_provider', 'Unknown provider "acme_pay". Use a provider from GET /v1/payment-gateways.', 'provider')],
    steps: [{ call: 'payments.confirm', args: { provider: 'acme_pay', reference: 'T_10', status: 'success', amount: '50', currency: 'NGN' }, expect: { error: { class: 'InvalidRequestError', code: 'unknown_provider', param: 'provider', http_status: 422 } } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'acme_pay', reference: 'T_10', status: 'success', amount: '50', currency: 'NGN' } }] },
  },
  // local validation: nothing is sent
  ...[
    ['missing_provider', { provider: null }, 'invalid_provider', 'provider'],
    ['provider_format', { provider: 'Paystack' }, 'invalid_provider', 'provider'],
    ['missing_reference', { reference: null }, 'invalid_reference', 'reference'],
    ['empty_reference', { reference: '' }, 'invalid_reference', 'reference'],
    ['long_reference', { reference: 'R'.repeat(129) }, 'invalid_reference', 'reference'],
    ['missing_status', { status: null }, 'invalid_status', 'status'],
    ['unknown_status', { status: 'paid' }, 'invalid_status', 'status'],
    ['amount_and_amount_minor', { amount: '50', amount_minor: 5000 }, 'amount_and_amount_minor', 'amount'],
    ['amount_format', { amount: '1,500' }, 'invalid_amount', 'amount'],
    ['amount_negative', { amount: '-5' }, 'invalid_amount', 'amount'],
    ['amount_minor_negative', { amount: null, amount_minor: -1 }, 'invalid_amount', 'amount_minor'],
    ['currency_format', { currency: 'NAIRA' }, 'invalid_currency', 'currency'],
    ['too_many_aliases', { aliases: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] }, 'invalid_aliases', 'aliases'],
    ['goal_format', { goal: 'Order Paid' }, 'invalid_goal_key', 'goal'],
  ].map(([id, over, code, param]) => ({
    id: `payments.confirm.local.${id}`,
    description: `Local validation: ${id.replaceAll('_', ' ')} → ${code}; nothing is sent`,
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_10', status: 'success', amount: '50', currency: 'NGN', ...over }, expect: payErr(code, param) }],
    expect: { requests: [] },
  })),
  // private mode ---------------------------------------------------------------------------
  {
    id: 'payments.confirm.private.allowed',
    description: 'Private mode: every B2.2 field is on the allow-list (click_id included)',
    client: { private_mode: true },
    responses: [confirmed({ reference: 'h:9f2c' })],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_11', status: 'success', amount: '50', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z', aliases: ['A_1'], click_id: CLICK, goal: 'order_paid', test: true } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'paystack', reference: 'T_11', status: 'success', amount: '50', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z', aliases: ['A_1'], click_id: CLICK, goal: 'order_paid', test: true } }] },
  },
  {
    id: 'payments.confirm.private.extra_email',
    description: 'Private mode: an extra email field is refused by name and nothing is sent',
    client: { private_mode: true },
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_12', status: 'success', amount: '50', currency: 'NGN', extra: { email: PM } }, expect: { error: guardErr('email') } }],
    expect: { requests: [], logs_exclude: [PM, 'T_12'] },
  },
  {
    id: 'payments.confirm.private.extra_order',
    description: 'Private mode: the first refused extra field is reported alphabetically',
    client: { private_mode: true },
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_13', status: 'success', extra: { phone: '+2348000000000', customer: { email: PM } } }, expect: { error: guardErr('customer') } }],
    expect: { requests: [], logs_exclude: [PM] },
  },
  {
    id: 'payments.confirm.extra_off',
    description: 'Private mode off: extra fields are merged last and sent (the API decides)',
    client: { private_mode: false },
    responses: [confirmed()],
    steps: [{ call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_14', status: 'success', amount: '50', currency: 'NGN', extra: { future_field: 1 } } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { provider: 'paystack', reference: 'T_14', status: 'success', amount: '50', currency: 'NGN', future_field: 1 } }] },
  },
  {
    id: 'payments.confirm.private.auto_config',
    description: 'private_mode auto: config is fetched before the first confirmation and the guard follows it',
    client: auto,
    responses: [ok(config({ private_mode: true })), confirmed()],
    steps: [
      { call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_15', status: 'success', amount: '50', currency: 'NGN', extra: { email: PM } }, expect: { error: guardErr('email') } },
      { call: 'payments.confirm', args: { provider: 'paystack', reference: 'T_15', status: 'success', amount: '50', currency: 'NGN' } },
    ],
    expect: { requests: [CONFIG_GET, { ...CONFIRM_POST, json: { provider: 'paystack', reference: 'T_15', status: 'success', amount: '50', currency: 'NGN' } }], logs_exclude: [PM] },
  },
  // helpers that send (payments.from) -------------------------------------------------------
  ...VECTORS.helpers.map((v, i) => ({
    id: `payments.from.vector_${i}_${HELPER_CALL[v.helper]}`,
    description: `${v.helper} sends only the extracted fields (${v.source})`,
    responses: [confirmed({ provider: v.expected.provider, reference: v.expected.reference })],
    steps: [{ call: 'payments.from', args: { gateway: HELPER_CALL[v.helper], response: v.input }, expect: { result: { object: 'payment_confirmation', reference: v.expected.reference } } }],
    expect: { requests: [{ ...CONFIRM_POST, headers: { 'idempotency-key': { $uuid4: true } }, json: helperBody(v) }] },
  })),
  {
    id: 'payments.from.options',
    description: 'goal and click_id options are added; the click_id option wins over the metadata',
    responses: [confirmed({ provider: 'stripe' })],
    steps: [{ call: 'payments.from', args: { gateway: 'stripe', response: stripeVector.input, goal: 'order_paid', click_id: CLICK2 } }],
    expect: { requests: [{ ...CONFIRM_POST, json: { ...helperBody(stripeVector), goal: 'order_paid', click_id: CLICK2 } }] },
  },
  {
    id: 'payments.from.nothing_to_send',
    description: 'A Checkout Session with no_payment_required: nothing is sent and the result is null',
    steps: [{ call: 'payments.from', args: { gateway: 'stripe', response: cs({ payment_status: 'no_payment_required', amount_total: 0 }) }, expect: { result: null } }],
    expect: { requests: [] },
  },
  {
    id: 'payments.from.unrecognised',
    description: 'A response the helper does not recognise: nothing is sent, the result is null, unrecognised_payment_response is warned',
    steps: [{ call: 'payments.from', args: { gateway: 'paystack', response: { status: false, message: 'Transaction reference not found' } }, expect: { result: null } }],
    expect: { requests: [], warnings: ['unrecognised_payment_response'] },
  },
  {
    id: 'payments.from.private',
    description: 'Private mode: the helper body is all allow-listed and is sent; the reference is not logged',
    client: { private_mode: true },
    responses: [confirmed({ reference: 'h:9f2c' })],
    steps: [{ call: 'payments.from', args: { gateway: 'paystack', response: paystackVector.input } }],
    expect: { requests: [{ ...CONFIRM_POST, json: helperBody(paystackVector) }], logs_exclude: [paystackVector.expected.reference] },
  },
  {
    id: 'payments.from.json_string',
    description: 'The verify response may be passed as the raw JSON text',
    responses: [confirmed()],
    steps: [{ call: 'payments.from', args: { gateway: 'paystack', response: JSON.stringify(paystackVector.input) } }],
    expect: { requests: [{ ...CONFIRM_POST, json: helperBody(paystackVector) }] },
  },
  // helpers that only build (payments.build): the vectors ------------------------------------
  ...VECTORS.helpers.map((v, i) => build(`vector_${i}_${HELPER_CALL[v.helper]}`, `${v.helper}: ${v.source}`, HELPER_CALL[v.helper], v.input, helperBody(v))),
  ...VECTORS.amounts.map((a, i) => {
    const currency = a.currency.toUpperCase();
    return build(
      `amount_${i}_${a.provider}_${a.currency.toLowerCase()}`,
      `${a.provider} amount ${JSON.stringify(a.input_amount)} ${a.currency} → "${a.amount}" (exact decimal, never a float)`,
      a.provider,
      amountInput(a),
      body(a.provider, amountRef[a.provider], 'success', { amount: a.amount, currency }),
    );
  }),
  // statuses
  ...[
    ['success', 'success'], ['failed', 'failed'], ['abandoned', 'failed'], ['reversed', 'reversed'],
    ['ongoing', 'pending'], ['pending', 'pending'], ['processing', 'pending'], ['queued', 'pending'],
  ].map(([s, n]) => build(`paystack_status_${s}`, `Paystack status ${s} → ${n}`, 'paystack', ps({ status: s }), body('paystack', 'T_1', n, { amount: '5000', currency: 'NGN' }))),
  build('paystack_status_unknown', 'Paystack: an unknown status → null (nothing to send)', 'paystack', ps({ status: 'mystery' }), null),
  ...[
    ['successful', 'success'], ['succeeded', 'success'], ['failed', 'failed'], ['voided', 'failed'], ['pending', 'pending'], ['new_status', 'pending'],
  ].map(([s, n]) => build(`flutterwave_status_${s}`, `Flutterwave status ${s} → ${n}`, 'flutterwave', fw({ status: s }), body('flutterwave', 'F_1', n, { amount: '100', currency: 'NGN' }))),
  ...[
    ['PAID', 'success'], ['OVERPAID', 'success'], ['PARTIALLY_PAID', 'partial'], ['FAILED', 'failed'], ['CANCELLED', 'failed'],
    ['ABANDONED', 'failed'], ['EXPIRED', 'failed'], ['PENDING', 'pending'], ['REVERSED', 'reversed'],
  ].map(([s, n]) => build(`monnify_status_${s.toLowerCase()}`, `Monnify paymentStatus ${s} → ${n}`, 'monnify', mn({ paymentStatus: s }), body('monnify', 'M_1', n, { amount: '100', currency: 'NGN' }))),
  build('monnify_status_unknown', 'Monnify: an unknown paymentStatus → null', 'monnify', mn({ paymentStatus: 'MYSTERY' }), null),
  ...[
    ['succeeded', 'success'], ['canceled', 'failed'], ['processing', 'pending'], ['requires_payment_method', 'pending'],
    ['requires_confirmation', 'pending'], ['requires_action', 'pending'], ['requires_capture', 'pending'],
  ].map(([s, n]) => build(`stripe_pi_status_${s}`, `Stripe PaymentIntent status ${s} → ${n}`, 'stripe', pi({ status: s }), body('stripe', 'pi_1', n, { amount: '20', currency: 'USD' }))),
  build('stripe_session_unpaid', 'Stripe Session payment_status unpaid → pending', 'stripe', cs({ payment_status: 'unpaid', status: 'open' }), body('stripe', 'pi_1', 'pending', { aliases: ['cs_test_1'], amount: '20', currency: 'USD' })),
  build('stripe_session_expired', 'Stripe Session unpaid and expired → failed', 'stripe', cs({ payment_status: 'unpaid', status: 'expired', payment_intent: null }), body('stripe', 'cs_test_1', 'failed', { amount: '20', currency: 'USD' })),
  build('stripe_session_no_payment_required', 'Stripe Session no_payment_required → null', 'stripe', cs({ payment_status: 'no_payment_required' }), null),
  // shapes, references, aliases, times and click IDs
  build('paystack_bare_data', 'Paystack: the data object alone (no envelope) works too', 'paystack', ps({ status: 'success' }).data, body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN' })),
  build('paystack_paidAt', 'Paystack: paidAt (camelCase) is read when paid_at is absent', 'paystack', ps({ status: 'success', paidAt: '2026-10-28T10:00:00.000Z' }), body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z' })),
  build('paystack_time_offset', 'An ISO time with an offset is converted to UTC; milliseconds are kept when not zero', 'paystack', ps({ status: 'success', paid_at: '2026-10-28T11:00:00.250+01:00' }), body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN', occurred_at: '2026-10-28T10:00:00.250Z' })),
  build('paystack_metadata_object', 'Paystack: metadata.cg_click_id', 'paystack', ps({ status: 'success', metadata: { cg_click_id: CLICK } }), body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN', click_id: CLICK })),
  build('paystack_metadata_string', 'Paystack: metadata as a JSON string', 'paystack', ps({ status: 'success', metadata: JSON.stringify({ cg_click_id: CLICK }) }), body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN', click_id: CLICK })),
  build('paystack_metadata_invalid_click', 'An invalid cg_click_id is not sent', 'paystack', ps({ status: 'success', metadata: { cg_click_id: 'clk_nope' } }), body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN' })),
  build('paystack_no_customer_data', 'Customer email, phone, authorization and log are never read', 'paystack', ps({ status: 'success', customer: { email: PM, phone: '+2348000000000' }, authorization: { last4: '4081', bin: '408408' }, log: { history: [] }, ip_address: '203.0.113.9', domain: 'live' }), body('paystack', 'T_1', 'success', { amount: '5000', currency: 'NGN', test: false })),
  build('paystack_missing_reference', 'Paystack: no reference → null', 'paystack', ps({ status: 'success', reference: null }), null),
  build('flutterwave_reference_fallback', 'Flutterwave: tx_ref missing, data.reference is used', 'flutterwave', fw({ status: 'successful', tx_ref: null, reference: 'F_ref' }), body('flutterwave', 'F_ref', 'success', { amount: '100', currency: 'NGN' })),
  build('flutterwave_meta_data', 'Flutterwave: meta_data.cg_click_id when meta is absent', 'flutterwave', fw({ status: 'successful', meta_data: { cg_click_id: CLICK } }), body('flutterwave', 'F_1', 'success', { amount: '100', currency: 'NGN', click_id: CLICK })),
  build('flutterwave_pending_no_amount', 'A pending response without an amount: amount and currency are omitted', 'flutterwave', { data: { tx_ref: 'F_2', status: 'pending' } }, body('flutterwave', 'F_2', 'pending')),
  build('monnify_iso_time', 'Monnify: an ISO paidOn is sent in UTC', 'monnify', mn({ paymentStatus: 'PAID', paidOn: '2026-10-28T11:00:00+01:00' }), body('monnify', 'M_1', 'success', { amount: '100', currency: 'NGN', occurred_at: '2026-10-28T10:00:00Z' })),
  build('monnify_local_time_omitted', 'Monnify: dd/MM/yyyy paidOn is omitted', 'monnify', mn({ paymentStatus: 'PAID', paidOn: '28/10/2026 10:00:00 AM' }), body('monnify', 'M_1', 'success', { amount: '100', currency: 'NGN' })),
  build('monnify_currency_code', 'Monnify: currencyCode when currency is absent', 'monnify', mn({ paymentStatus: 'PAID', currency: null, currencyCode: 'NGN' }), body('monnify', 'M_1', 'success', { amount: '100', currency: 'NGN' })),
  build('monnify_alias_same_as_reference', 'Monnify: a transactionReference equal to the reference is not an alias', 'monnify', mn({ paymentStatus: 'PAID', transactionReference: 'M_1' }), body('monnify', 'M_1', 'success', { amount: '100', currency: 'NGN' })),
  build('monnify_event_data', 'Monnify: a webhook eventData object works too', 'monnify', { eventType: 'SUCCESSFUL_TRANSACTION', eventData: { paymentReference: 'M_3', transactionReference: 'MNFY|1', paymentStatus: 'PAID', amountPaid: 250, currency: 'NGN' } }, body('monnify', 'M_3', 'success', { aliases: ['MNFY|1'], amount: '250', currency: 'NGN' })),
  build('stripe_pi_amount_fallback', 'Stripe: amount_received 0 falls back to amount', 'stripe', pi({ status: 'processing', amount_received: 0 }), body('stripe', 'pi_1', 'pending', { amount: '20', currency: 'USD' })),
  build('stripe_pi_livemode', 'Stripe: livemode true → test false; created → occurred_at', 'stripe', pi({ livemode: true, created: 1793016000 }), body('stripe', 'pi_1', 'success', { amount: '20', currency: 'USD', occurred_at: '2026-10-26T12:00:00Z', test: false })),
  build('stripe_session_expanded_intent', 'Stripe Session: an expanded payment_intent object gives its id', 'stripe', cs({ payment_intent: { id: 'pi_9', object: 'payment_intent' }, client_reference_id: 'cart-1' }), body('stripe', 'pi_9', 'success', { aliases: ['cs_test_1', 'cart-1'], amount: '20', currency: 'USD' })),
  build('stripe_unknown_object', 'Stripe: an object that is neither a PaymentIntent nor a Checkout Session → null', 'stripe', { id: 'ch_1', object: 'charge', amount: 2000, currency: 'usd', status: 'succeeded' }, null),
  build('not_an_object', 'A response that is not an object or JSON text → null', 'paystack', 'not json', null),
  build('array', 'An array → null', 'flutterwave', [1, 2], null),
]);

// ---------------------------------------------------------------------------------------------
// Change 12 (S.3): an SDK released today must keep working against a newer API. Unknown response fields,
// unknown enum values (a future GoalStatus, GoalKind or Provider) and unknown error keys are ignored, never
// an error; the wire object is still returned with every field (typed SDKs keep them in the raw JSON).
const FUTURE = { future_field: { nested: [1, 'two', null], flag: true }, future_list: ['a'] };
const FUTURE_EVENT = JSON.stringify({ ...event, type: 'goal.future_event', future_field: 1, data: { ...event.data, object: { ...event.data.object, status: 'deferred', goal_kind: 'subscription', future_field: true } } });
add('compat', 'Forward compatibility: older SDK versions ignore unknown fields and enum values (change 12 S.3)', [
  {
    id: 'compat.goal_event.unknown_fields',
    description: 'A goal_event with fields this SDK does not know is returned as usual, unknown fields kept',
    responses: [ok(goalEvent(FUTURE), 201)],
    steps: [{ ...send, expect: { result: { status: 'counted', counted: true, goal_kind: 'standard', ...FUTURE } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'compat.goal_event.unknown_enum_values',
    description: 'A GoalStatus, GoalKind or Provider this SDK does not know is kept as its string, not an error',
    responses: [ok(goalEvent({ status: 'deferred', reason: 'future_reason', goal_kind: 'subscription', counted: false, event_status: 'future_state', payment: { confirmation_id: PCF, match_status: 'future_match', report_id: null, provider: 'acme_pay' } }), 201)],
    steps: [{ ...send, expect: { result: { status: 'deferred', reason: 'future_reason', goal_kind: 'subscription', counted: false, event_status: 'future_state', payment: { provider: 'acme_pay', match_status: 'future_match' } } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'compat.goal_event.missing_new_fields',
    description: 'A goal_event from an older API (no goal_kind, value_ignored, event_status or payment) still works',
    responses: [ok({ object: 'goal_event', id: 'cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE', status: 'counted', goal: 'account_opened', reference: 'APP-55231', value: '2000000', currency: 'NGN', counted: true, reason: null, attributed_to: null, occurred_at: '2026-10-23T09:12:00Z', received_at: '2026-10-23T09:12:01Z', livemode: false }, 201)],
    steps: [{ ...send, expect: { result: { status: 'counted', counted: true, goal: 'account_opened' } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'compat.batch.unknown_fields',
    description: 'Batch responses and items with unknown fields are returned as usual',
    responses: [ok({ object: 'list', ...FUTURE, data: [{ index: 0, ok: true, status: 201, future_item: 'x', goal_event: goalEvent({ reference: 'R-0', status: 'deferred', ...FUTURE }), error: null }] })],
    steps: [{ call: 'goals.send_batch', args: { events: [ev(0)] }, expect: { result: { object: 'list', future_field: FUTURE.future_field, data: [{ index: 0, ok: true, future_item: 'x', goal_event: { status: 'deferred', future_list: ['a'] } }] } } }],
    expect: { requests: [BATCH_POST] },
  },
  {
    id: 'compat.background.unknown_fields',
    description: 'Background sending ignores unknown fields and status values in batch results: no on_error',
    client: { send_mode: 'background' },
    responses: [ok({ object: 'list', ...FUTURE, data: [{ index: 0, ok: true, status: 201, goal_event: goalEvent({ reference: 'R-0', status: 'deferred', goal_kind: 'subscription', ...FUTURE }), error: null }] })],
    steps: [{ call: 'goal', args: { key: 'order_paid', reference: 'R-0' } }, { call: 'flush', expect: { result: { value: true } } }],
    expect: { requests: [BATCH_POST], on_error: [] },
  },
  {
    id: 'compat.config.unknown_fields',
    description: 'A server SDK config with unknown fields (also on goals) is used as usual: warnings and guard unchanged',
    client: { private_mode: 'auto' },
    responses: [ok(config({ ...FUTURE, goals: [{ key: 'order_paid', value_mode: 'required', default_currency: 'NGN', kind: 'payment', future_field: 1 }] })), created],
    steps: [{ call: 'goals.send', args: { key: 'order_paid', reference: 'T-1', provider: 'paystack' }, expect: { result: { status: 'counted' } } }],
    expect: { requests: [CONFIG_GET, { ...GOAL_POST, json: { goal: 'order_paid', reference: 'T-1', provider: 'paystack' } }], warnings: ['value_required'] },
  },
  {
    id: 'compat.payment_confirmation.unknown_fields',
    description: 'A payment_confirmation with unknown fields and a newer provider value is returned as usual',
    responses: [ok(confirmation({ provider: 'acme_pay', match_status: 'future_match', ...FUTURE }))],
    steps: [{ call: 'payments.confirm', args: { provider: 'acme_pay', reference: 'T_ref_001', status: 'success', amount: '7500', currency: 'NGN' }, expect: { result: { provider: 'acme_pay', match_status: 'future_match', ...FUTURE } } }],
    expect: { requests: [CONFIRM_POST] },
  },
  {
    id: 'compat.link.unknown_fields',
    description: 'A link with unknown fields is returned as usual',
    responses: [ok(link(FUTURE))],
    steps: [{ call: 'links.get', args: { id: LINK }, expect: { result: { id: LINK, ...FUTURE } } }],
    expect: { requests: [{ method: 'GET', path: `/v1/links/${LINK}` }] },
  },
  {
    id: 'compat.error.unknown_keys',
    description: 'An error envelope with unknown keys maps by status and code as usual',
    responses: [goalErr(422, 'invalid_request', 'future_error_code', 'Something new.', 'future_param', { future_field: { a: 1 }, missing: ['provider'] })],
    steps: [{ ...send, expect: { error: { class: 'InvalidRequestError', code: 'future_error_code', param: 'future_param', http_status: 422 } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'compat.error.unknown_type',
    description: 'An error envelope with an unknown type maps by status (403 → PermissionError)',
    responses: [goalErr(403, 'future_type', 'future_gate', 'Something new.', null)],
    steps: [{ ...send, expect: { error: { class: 'PermissionError', code: 'future_gate', http_status: 403 } } }],
    expect: { requests: [GOAL_POST] },
  },
  {
    id: 'compat.webhook.unknown_fields',
    description: 'A signed webhook event of an unknown type with unknown fields verifies and is returned with them',
    steps: [{ call: 'webhooks.verify', args: { raw_body: FUTURE_EVENT, header: hdr(NOW_S, sig(SECRET, NOW_S, FUTURE_EVENT)), secret: SECRET, tolerance: 300, now: NOW_S }, expect: { result: { type: 'goal.future_event', future_field: 1, data: { object: { status: 'deferred', goal_kind: 'subscription', future_field: true } } } } }],
    expect: { requests: [] },
  },
]);

// ---------------------------------------------------------------------------------------------
// Structural validation against schema/case.schema.json (keys and step calls; no dependency needed)
const schema = JSON.parse(readFileSync(join(here, '..', 'schema', 'case.schema.json'), 'utf8')).$defs;

// ---------------------------------------------------------------------------------------------
// Change 14 (S.1): identifyUser() and goal labels (SPEC 24; backend B.5 POST /v1/people/identify).
const IDENTIFY_POST = { method: 'POST', path: '/v1/people/identify' };
const identified = (labelIgnored = null) => ok({ object: 'person_identified', person_id: 'per_01JCK8Z9V7Q4M2N6P8R0S2T4PE', label_ignored: labelIgnored }, 200);
add('people', 'identifyUser() and goal labels (SPEC 24; backend change 14 B.5)', [
  {
    id: 'people.identify.click_customer_label',
    description: 'A click, a customer ID and a label map to the wire; the person is returned',
    responses: [identified()],
    steps: [{ call: 'identify_user', args: { click_id: CLICK, customer_id: 'user_42', label: 'Ada (VIP)' }, expect: { result: { object: 'person_identified', person_id: 'per_01JCK8Z9V7Q4M2N6P8R0S2T4PE', label_ignored: null } } }],
    expect: { requests: [{ ...IDENTIFY_POST, json: { click_id: CLICK, customer_id: 'user_42', label: 'Ada (VIP)' } }] },
  },
  {
    id: 'people.identify.installation_plan',
    description: 'An app installation (both IDs) with a label; label_ignored "plan" is returned as is',
    responses: [identified('plan')],
    steps: [{ call: 'identify_user', args: { app_id: 'app_01JCK8Z9V7Q4M2N6P8R0S2T4AP', installation_id: '6a1f0c2e-0000-4000-8000-000000000001', label: 'Ada' }, expect: { result: { label_ignored: 'plan' } } }],
    expect: { requests: [{ ...IDENTIFY_POST, json: { app_id: 'app_01JCK8Z9V7Q4M2N6P8R0S2T4AP', installation_id: '6a1f0c2e-0000-4000-8000-000000000001', label: 'Ada' } }] },
  },
  {
    id: 'people.identify.needs_a_reference',
    description: 'Without a click, an installation or a customer ID nothing is sent (local invalid_request)',
    steps: [
      { call: 'identify_user', args: { label: 'Ada' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_request', param: 'click_id', http_status: null } } },
      { call: 'identify_user', args: { app_id: 'app_01JCK8Z9V7Q4M2N6P8R0S2T4AP' }, expect: { error: { class: 'InvalidRequestError', code: 'invalid_request', param: 'installation_id', http_status: null } } },
    ],
    expect: { requests: [] },
  },
  {
    id: 'people.identify.private_mode_customer_refused',
    description: 'In private mode the customer ID is refused by the guard; a label is allowed (the API checks the switch)',
    client: { private_mode: true },
    responses: [identified()],
    steps: [
      { call: 'identify_user', args: { click_id: CLICK, customer_id: PM }, expect: { error: guardErr('customer_id') } },
      { call: 'identify_user', args: { click_id: CLICK, label: 'Ada' } },
    ],
    expect: { requests: [{ ...IDENTIFY_POST, json: { click_id: CLICK, label: 'Ada' } }], logs_exclude: [PM] },
  },
  {
    id: 'people.goal.label_and_is_first',
    description: 'goals.send carries label and is_first; label is allowed by the private-mode guard',
    client: { private_mode: true },
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', click_id: CLICK, is_first: true, label: 'Ada' } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', click_id: CLICK, is_first: true, label: 'Ada' } }] },
  },
  {
    id: 'people.identify.labels_off_in_private_mode',
    description: 'The API error labels_off_in_private_mode (422) is an InvalidRequestError',
    responses: [err(422, 'invalid_request', 'labels_off_in_private_mode', 'Labels are off in private mode.')],
    steps: [{ call: 'identify_user', args: { click_id: CLICK, label: 'Ada' }, expect: { error: { class: 'InvalidRequestError', code: 'labels_off_in_private_mode', http_status: 422 } } }],
    expect: { requests: [{ ...IDENTIFY_POST, json: { click_id: CLICK, label: 'Ada' } }] },
  },
]);

// ---------------------------------------------------------------------------------------------
// Change 19 (C19-S1, R.20 S.3): hashed email and phone for ad network matching (SPEC 25; backend C19-B4
// goal_event_schemas.py / report_conversion_schema.py). Vectors: clikgate_website apps/www/samples/ads-hashing/.
const H_EMAIL = '0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed'; // "  Ada.Obi@Example.com "
const H_E164 = '6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c'; // "+2348031234567"
const H_DIGITS = 'fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17'; // "2348031234567"
const HASHED = { hashed_email: H_EMAIL, hashed_phone_e164: H_E164, hashed_phone_digits: H_DIGITS };
const badHash = (param) => ({ class: 'InvalidRequestError', code: 'invalid_hashed_identifier', param, http_status: null });
const badInput = (param, input) => ({ class: 'InvalidRequestError', code: 'invalid_argument', param, http_status: null, message_excludes: [input] });
add('ads_matching', 'Hashed email and phone for ad network matching: hash_for_ads and the goal options (SPEC 25; backend change 19 B.5, R.5)', [
  {
    id: 'ads_matching.hash_for_ads.vectors',
    description: 'hash_for_ads trims and lowercases the email and hashes the phone with and without the +; 00 works like +',
    steps: [
      { call: 'hash_for_ads', args: { email: '  Ada.Obi@Example.com ', phone: '+234 803 123 4567' }, expect: { result: HASHED } },
      { call: 'hash_for_ads', args: { phone: '00234 (803) 123-4567' }, expect: { result: { hashed_phone_e164: H_E164, hashed_phone_digits: H_DIGITS } } },
      { call: 'hash_for_ads', args: { email: 'ada.obi@example.com' }, expect: { result: { hashed_email: H_EMAIL } } },
    ],
    expect: { requests: [] },
  },
  {
    id: 'ads_matching.hash_for_ads.refused',
    description: 'A phone without its country code, a too short phone or an email without @ is invalid_argument; the input is never echoed',
    steps: [
      { call: 'hash_for_ads', args: { phone: '0803 123 4567' }, expect: { error: badInput('phone', '0803 123 4567') } },
      { call: 'hash_for_ads', args: { phone: '+12345' }, expect: { error: badInput('phone', '+12345') } },
      { call: 'hash_for_ads', args: { phone: '+0803 123 4567' }, expect: { error: badInput('phone', '+0803 123 4567') } },
      { call: 'hash_for_ads', args: { email: 'ada.obi.example.com' }, expect: { error: badInput('email', 'ada.obi.example.com') } },
    ],
    expect: { requests: [] },
  },
  {
    id: 'ads_matching.goal.hashed_fields',
    description: 'goals.send carries hashed_email, hashed_phone_e164 and hashed_phone_digits on the wire',
    responses: [created],
    steps: [{ call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', click_id: CLICK, ...HASHED } }],
    expect: { requests: [{ ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', click_id: CLICK, ...HASHED } }] },
  },
  {
    id: 'ads_matching.goal.invalid_hash',
    description: 'A value that is not 64 lowercase hex characters is refused locally (invalid_hashed_identifier); nothing is sent',
    steps: [
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', hashed_email: H_EMAIL.toUpperCase() }, expect: { error: badHash('hashed_email') } },
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', hashed_phone_e164: '+2348031234567' }, expect: { error: { ...badHash('hashed_phone_e164'), message_excludes: ['+2348031234567'] } } },
      { call: 'goals.send_batch', args: { events: [{ goal: 'account_opened', reference: 'APP-1' }, { goal: 'account_opened', reference: 'APP-2', hashed_phone_digits: 'abc' }] }, expect: { error: { ...badHash('hashed_phone_digits'), index: 1 } } },
    ],
    expect: { requests: [] },
  },
  {
    id: 'ads_matching.private_mode.goal_and_batch_allowed',
    description: 'The private-mode guard allows the three hashed fields on goals and batch events (the API decides the rest)',
    client: { private_mode: true },
    responses: [created, ok({ object: 'list', data: [{ index: 0, ok: true, status: 201, goal_event: goalEvent() }] })],
    steps: [
      { call: 'goals.send', args: { key: 'account_opened', reference: 'APP-1', click_id: CLICK, hashed_email: H_EMAIL } },
      { call: 'goals.send_batch', args: { events: [{ goal: 'account_opened', reference: 'APP-2', hashed_phone_e164: H_E164, hashed_phone_digits: H_DIGITS }] } },
    ],
    expect: {
      requests: [
        { ...GOAL_POST, json: { goal: 'account_opened', reference: 'APP-1', click_id: CLICK, hashed_email: H_EMAIL } },
        { ...BATCH_POST, json: { events: [{ goal: 'account_opened', reference: 'APP-2', hashed_phone_e164: H_E164, hashed_phone_digits: H_DIGITS }] } },
      ],
      logs_exclude: [H_EMAIL, H_E164, H_DIGITS],
    },
  },
  {
    id: 'ads_matching.private_mode.conversion_allowed',
    description: 'conversions.create passes the hashed fields in private mode; raw customer details stay refused',
    client: { private_mode: true },
    responses: [ok({ object: 'conversion', id: 'cnv_5' }, 201)],
    steps: [
      { call: 'conversions.create', args: { params: { external_id: 'ORD-1', click_id: CLICK, goal: 'order_paid', ...HASHED } } },
      { call: 'conversions.create', args: { params: { external_id: 'ORD-2', click_id: CLICK, customer: { email: PM } } }, expect: { error: guardErr('customer') } },
    ],
    expect: { requests: [{ method: 'POST', path: '/v1/conversions', json: { external_id: 'ORD-1', click_id: CLICK, goal: 'order_paid', ...HASHED } }], logs_exclude: [PM] },
  },
  {
    id: 'ads_matching.conversion.invalid_hash',
    description: 'conversions.create refuses a malformed hashed field locally (invalid_hashed_identifier)',
    steps: [{ call: 'conversions.create', args: { params: { external_id: 'ORD-1', hashed_email: 'ada.obi@example.com' } }, expect: { error: { ...badHash('hashed_email'), message_excludes: ['ada.obi@example.com'] } } }],
    expect: { requests: [] },
  },
]);

const problems = [];
const keysOk = (obj, def, where) => {
  for (const k of Object.keys(obj ?? {})) if (!(k in schema[def].properties)) problems.push(`${where}: unknown key ${k}`);
};
for (const doc of Object.values(files)) {
  for (const c of doc.cases) {
    keysOk(c, 'case', c.id);
    for (const k of Object.keys(c.client ?? {})) if (!(k in schema.case.properties.client.properties)) problems.push(`${c.id}: unknown client option ${k}`);
    (c.responses ?? []).forEach((r, i) => keysOk(r, 'response', `${c.id} responses[${i}]`));
    c.steps.forEach((st, i) => {
      keysOk(st, 'step', `${c.id} steps[${i}]`);
      if (!schema.step.properties.call.enum.includes(st.call)) problems.push(`${c.id} steps[${i}]: unknown call ${st.call}`);
    });
    keysOk(c.expect, 'expect', `${c.id} expect`);
    (c.expect.requests ?? []).forEach((r, i) => keysOk(r, 'request', `${c.id} requests[${i}]`));
  }
}
if (problems.length) {
  console.error(`Invalid cases:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
let stale = [];
let total = 0;
const expectedFiles = new Set();
for (const [suite, doc] of Object.entries(files)) {
  for (const c of doc.cases) c.now_ms = c.now_ms ?? NOW_MS;
  total += doc.cases.length;
  const file = join(outDir, `${suite}.json`);
  expectedFiles.add(`${suite}.json`);
  const text = `${JSON.stringify({ $schema: '../schema/case.schema.json', ...doc }, null, 2)}\n`;
  if (check) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) stale.push(file);
  } else writeFileSync(file, text);
}
for (const f of readdirSync(outDir)) if (f.endsWith('.json') && !expectedFiles.has(f)) stale.push(join(outDir, f));
if (check && stale.length) {
  console.error(`Conformance cases are out of date (run node server/conformance/tools/build-cases.mjs):\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
console.log(`${check ? 'Checked' : 'Wrote'} ${Object.keys(files).length} files, ${total} cases.`);
