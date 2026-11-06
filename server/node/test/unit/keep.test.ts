import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { Clikgate, InvalidRequestError, PrivateModeFieldRejectedError, clickIds, type KeepRoute } from '../../src/index.js';
import { capture, client } from './helpers.js';

const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';
const OTHER = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W7';
const BODY = JSON.stringify({ click_id: CLICK, page_click_id: CLICK });
const major = Number(process.versions.node.split('.')[0]);

function post(body: string | undefined, headers: Record<string, string> = { host: 'shop.example.com', 'sec-fetch-site': 'same-origin' }, method = 'POST'): Request {
  return new Request('https://shop.example.com/cg/keep', { method, headers, body: method === 'GET' ? undefined : body });
}

async function call(route: KeepRoute, req: Request) {
  const res = await route(req);
  return { status: res.status, cache: res.headers.get('cache-control'), cookies: res.headers.getSetCookie(), body: await res.text(), location: res.headers.get('location'), allow: res.headers.get('allow') };
}

test('keepRoute: 204 with the click-ID cookie and the marker, readable by the web script', async () => {
  const r = await call(clickIds.keepRoute(), post(BODY));
  assert.equal(r.status, 204);
  assert.equal(r.cache, 'no-store, private');
  assert.equal(r.body, '');
  assert.equal(r.location, null);
  assert.deepEqual(r.cookies, [`_cg_cgid=${CLICK}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`, '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure']);
  for (const c of r.cookies) assert.doesNotMatch(c, /HttpOnly/i);
});

test('keepRoute: days, domain and secure follow the options on both cookies', async () => {
  const r = await call(clickIds.keepRoute({ days: 400, domain: '.example.com', secure: false }), post(BODY));
  assert.deepEqual(r.cookies, [`_cg_cgid=${CLICK}; Path=/; Max-Age=34560000; Domain=.example.com; SameSite=Lax`, '_cg_kept=s; Path=/; Max-Age=34560000; Domain=.example.com; SameSite=Lax']);
});

test('keepRoute: days outside 1-400 is invalid_argument at construction', () => {
  for (const days of [0, 401, Number.NaN, -1]) {
    assert.throws(() => clickIds.keepRoute({ days }), (e: unknown) => e instanceof InvalidRequestError && e.code === 'invalid_argument' && e.param === 'days');
  }
});

test('keepRoute: the cookie name comes from the client configuration', async () => {
  const c = new Clikgate({ apiKey: 'cg_test_unit000000', clickIdParam: 'ref', shutdownHooks: false, privateMode: false });
  const r = await call(c.clickIds.keepRoute(), post(JSON.stringify({ click_id: CLICK, page_click_id: CLICK, name: 'session' })));
  assert.match(r.cookies[0]!, /^_cg_ref=/);
  await c.close(10);
});

test('keepRoute: same-origin checks (Sec-Fetch-Site, then Origin against Host or X-Forwarded-Host)', async () => {
  const route = clickIds.keepRoute();
  const cases: Array<[Record<string, string>, number]> = [
    [{ host: 'shop.example.com', 'sec-fetch-site': 'same-origin' }, 204],
    [{ host: 'shop.example.com', 'Sec-Fetch-Site': 'SAME-ORIGIN' }, 204],
    [{ host: 'shop.example.com', 'sec-fetch-site': 'cross-site', origin: 'https://shop.example.com' }, 403],
    [{ host: 'shop.example.com', 'sec-fetch-site': 'same-site' }, 403],
    [{ host: 'shop.example.com', 'sec-fetch-site': 'none' }, 403],
    [{ host: 'shop.example.com', origin: 'https://shop.example.com' }, 204],
    [{ host: 'Shop.Example.com', origin: 'https://shop.example.COM' }, 204],
    [{ host: 'shop.example.com:8080', origin: 'http://shop.example.com:8080' }, 204],
    [{ host: 'shop.example.com', origin: 'https://shop.example.com:8443' }, 403],
    [{ host: 'shop.example.com', origin: 'https://evil.example.net' }, 403],
    [{ host: 'shop.example.com', origin: 'ftp://shop.example.com' }, 403],
    [{ host: 'shop.example.com', origin: 'null' }, 403],
    [{ host: 'shop.example.com' }, 403],
    [{ host: 'app:3000', 'x-forwarded-host': 'shop.example.com, proxy.internal', origin: 'https://shop.example.com' }, 204],
    [{ host: 'shop.example.com', 'x-forwarded-host': 'proxy.internal', origin: 'https://shop.example.com' }, 403],
  ];
  for (const [headers, status] of cases) {
    const r = await call(route, post(BODY, headers));
    assert.equal(r.status, status, JSON.stringify(headers));
    assert.equal(r.cache, 'no-store, private');
    if (status !== 204) assert.deepEqual(r.cookies, []);
  }
});

test('keepRoute: only POST (405 + Allow: POST), the query string is never read', async () => {
  const route = clickIds.keepRoute();
  for (const method of ['GET', 'PUT', 'DELETE', 'OPTIONS']) {
    const req = new Request(`https://shop.example.com/cg/keep?click_id=${CLICK}&page_click_id=${CLICK}`, {
      method,
      headers: { host: 'shop.example.com', 'sec-fetch-site': 'same-origin' },
      body: method === 'GET' ? undefined : BODY,
    });
    const r = await call(route, req);
    assert.equal(r.status, 405);
    assert.equal(r.allow, 'POST');
    assert.equal(r.cache, 'no-store, private');
    assert.deepEqual(r.cookies, []);
  }
});

test('keepRoute: bad bodies are 400, never echoed, never redirected', async () => {
  const route = clickIds.keepRoute();
  const bodies = [
    '',
    'not json',
    '[]',
    'null',
    '"clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"',
    JSON.stringify({ click_id: CLICK }),
    JSON.stringify({ click_id: CLICK, page_click_id: OTHER }),
    JSON.stringify({ click_id: '<script>alert(1)</script>', page_click_id: '<script>alert(1)</script>' }),
    JSON.stringify({ click_id: CLICK.toLowerCase(), page_click_id: CLICK.toLowerCase() }),
    JSON.stringify({ click_id: 42, page_click_id: 42 }),
    JSON.stringify({ click_id: CLICK, page_click_id: CLICK, pad: 'x'.repeat(1024) }),
  ];
  for (const body of bodies) {
    const r = await call(route, post(body));
    assert.equal(r.status, 400, body.slice(0, 60));
    assert.equal(r.body, '');
    assert.equal(r.location, null);
    assert.deepEqual(r.cookies, []);
  }
  // exactly 1024 bytes is accepted
  const pad = 1024 - JSON.stringify({ click_id: CLICK, page_click_id: CLICK, p: '' }).length;
  const exact = JSON.stringify({ click_id: CLICK, page_click_id: CLICK, p: 'x'.repeat(pad) });
  assert.equal(Buffer.byteLength(exact), 1024);
  assert.equal((await call(route, post(exact))).status, 204);
});

test('keepRoute: never logs the input', async () => {
  const logs: string[] = [];
  const c = new Clikgate({ apiKey: 'cg_test_unit000000', shutdownHooks: false, privateMode: false, logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) } });
  const route = c.clickIds.keepRoute();
  await call(route, post(BODY));
  await call(route, post('{"click_id":"<b>x</b>"}'));
  assert.deepEqual(logs, []);
  await c.close(10);
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    return await new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: opts.path ?? '/cg/keep', method: opts.method ?? 'POST', headers: opts.headers ?? {} }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end(opts.body);
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
}

const SAME = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };

test('keepRoute.node on a plain node:http server', async () => {
  const route = clickIds.keepRoute();
  const ok = await serve((req, res) => route.node(req, res), { headers: SAME, body: BODY });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['cache-control'], 'no-store, private');
  assert.deepEqual(ok.headers['set-cookie'], [`_cg_cgid=${CLICK}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`, '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure']);
  assert.equal(ok.body, '');
  const big = await serve((req, res) => route.node(req, res), { headers: SAME, body: JSON.stringify({ click_id: CLICK, page_click_id: CLICK, pad: 'x'.repeat(5000) }) });
  assert.equal(big.status, 400);
  assert.equal(big.headers['set-cookie'], undefined);
  const get = await serve((req, res) => route.node(req, res), { method: 'GET', headers: SAME });
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, 'POST');
  // Host is the test server's 127.0.0.1:<port>, so an Origin for another host is refused
  const cross = await serve((req, res) => route.node(req, res), { headers: { origin: 'https://evil.example.net' }, body: BODY });
  assert.equal(cross.status, 403);
  assert.equal(cross.headers.location, undefined);
});

test('keepRoute.express in an Express 5 app, with and without express.json()', async () => {
  const { default: express } = await import('express');
  const route = clickIds.keepRoute({ days: 90 });
  const raw = express();
  raw.post('/cg/keep', route.express);
  const parsed = express();
  parsed.use(express.json());
  parsed.all('/cg/keep', route.express);
  for (const app of [raw, parsed]) {
    const handler = app as unknown as (req: IncomingMessage, res: ServerResponse) => void;
    const ok = await serve(handler, { headers: SAME, body: BODY });
    assert.equal(ok.status, 204);
    assert.equal((ok.headers['set-cookie'] ?? []).length, 2);
    assert.match(ok.headers['set-cookie']![0]!, /Max-Age=7776000/);
    const bad = await serve(handler, { headers: SAME, body: JSON.stringify({ click_id: CLICK, page_click_id: OTHER }) });
    assert.equal(bad.status, 400);
    assert.equal(bad.body, '');
    assert.equal(bad.headers['cache-control'], 'no-store, private');
  }
  const get = await serve(parsed as unknown as (req: IncomingMessage, res: ServerResponse) => void, { method: 'GET', headers: SAME });
  assert.equal(get.status, 405);
});

test('next keepRoute uses the proxy parameter (Next 16 needs Node 20.9+)', { skip: major < 20 }, async () => {
  const { keepRoute } = await import('../../src/next.js');
  const r = await call(keepRoute({ clickIdParam: 'ref' }), post(BODY));
  assert.equal(r.status, 204);
  assert.match(r.cookies[0]!, /^_cg_ref=/);
});

const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

test('context(): kept_by from the cookie, marker and header; engine and platform from the User-Agent', () => {
  assert.deepEqual(clickIds.context({ url: '/checkout', headers: { cookie: `_cg_cgid=${CLICK}; _cg_kept=s`, 'user-agent': IPHONE_CHROME } }), {
    clickId: CLICK,
    keptBy: 'server_cookie',
    browserEngine: 'webkit_ios',
    platform: 'ios',
  });
  assert.equal(clickIds.context({ url: '/checkout', headers: { Cookie: `_cg_cgid=${CLICK}`, 'User-Agent': MAC_SAFARI } }).keptBy, 'script_cookie');
  assert.equal(clickIds.context({ url: '/', headers: { 'clikgate-click-id': CLICK } }).keptBy, 'form');
  assert.equal(clickIds.context({ url: `/?cgid=${CLICK}`, headers: { cookie: `_cg_cgid=${OTHER}; _cg_kept=s` } }).keptBy, null);
  assert.deepEqual(clickIds.context({ url: '/', headers: {} }), { clickId: null, keptBy: null, browserEngine: 'other', platform: 'other' });
  // a Fetch Request works too
  const fetchReq = new Request('https://shop.example.com/x', { headers: { cookie: `_cg_cgid=${CLICK}; _cg_kept=s`, 'user-agent': MAC_SAFARI } });
  assert.deepEqual(clickIds.context(fetchReq), { clickId: CLICK, keptBy: 'server_cookie', browserEngine: 'safari_mac', platform: 'macos' });
});

test('goal options keptBy/browserEngine/platform: validated, sent as snake_case, allowed in private mode', async () => {
  const { calls, fetchLike } = capture([{ status: 201, json: { object: 'goal_event', id: 'gev_1', status: 'counted' } }]);
  const c = client(fetchLike, { privateMode: true });
  const ctx = clickIds.context({ url: '/', headers: { cookie: `_cg_cgid=${CLICK}; _cg_kept=s`, 'user-agent': IPHONE_CHROME } });
  await c.goals.send('account_opened', { reference: 'APP-1', ...ctx });
  assert.deepEqual(JSON.parse(calls[0]!.body), { goal: 'account_opened', reference: 'APP-1', click_id: CLICK, kept_by: 'server_cookie', browser_engine: 'webkit_ios', platform: 'ios' });
  for (const bad of [{ keptBy: 'cookie' }, { browserEngine: 'blink' }, { platform: 'ipados' }]) {
    await assert.rejects(
      c.goals.send('account_opened', { reference: 'APP-2', ...(bad as object) }),
      (e: unknown) => e instanceof InvalidRequestError && !(e instanceof PrivateModeFieldRejectedError) && e.code === 'invalid_argument' && e.httpStatus === null,
    );
  }
  assert.equal(calls.length, 1);
  await c.close(10);
});
