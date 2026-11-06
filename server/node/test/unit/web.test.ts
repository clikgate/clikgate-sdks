import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { webhooks, clickIds, SignatureVerificationError } from '../../src/index.js';
import { clikgateMiddleware } from '../../src/express.js';

const CLICK = 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6';
const major = Number(process.versions.node.split('.')[0]);

test('webhooks.verify accepts a Buffer body and refuses parsed JSON', () => {
  const body = JSON.stringify({ id: 'evt_1', object: 'event', type: 'goal.completed', data: { object: {} } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex');
  assert.equal(webhooks.verify(Buffer.from(body), `t=${t},v1=${sig}`, 'whsec_x').id, 'evt_1');
  assert.throws(() => webhooks.verify(JSON.parse(body) as string, `t=${t},v1=${sig}`, 'whsec_x'), (e: unknown) => e instanceof SignatureVerificationError && e.code === 'invalid_payload');
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void, path: string, headers: Record<string, string> = {}) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    return await new Promise<{ status: number; setCookie: string[]; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, setCookie: res.headers['set-cookie'] ?? [], body }));
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

test('persist() on a real ServerResponse keeps existing cookies', async () => {
  const r = await serve((_req, res) => {
    res.setHeader('Set-Cookie', 'session=abc; Path=/');
    clickIds.persist(res, CLICK);
    res.end('ok');
  }, '/');
  assert.equal(r.setCookie.length, 3);
  assert.match(r.setCookie[1]!, /^_cg_cgid=clk_[0-9A-Z]{26}; Path=\/; Max-Age=2592000; SameSite=Lax$/); // plain HTTP: no Secure
  assert.equal(r.setCookie[2], '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax'); // the marker (change 16)
});

test('express/connect middleware exposes req.clikgate and persists query click IDs', async () => {
  const mw = clikgateMiddleware(null);
  const handler = (req: IncomingMessage, res: ServerResponse) =>
    mw(req, res, () => {
      res.end(JSON.stringify((req as IncomingMessage & { clikgate: unknown }).clikgate));
    });
  const fromQuery = await serve(handler, `/landing?cgid=${CLICK}`);
  assert.deepEqual(JSON.parse(fromQuery.body), { clickId: CLICK });
  assert.equal(fromQuery.setCookie.length, 2);
  const fromCookie = await serve(handler, '/signup', { cookie: `_cg_cgid=${CLICK}` });
  assert.deepEqual(JSON.parse(fromCookie.body), { clickId: CLICK });
  assert.equal(fromCookie.setCookie.length, 0);
});

test('express 5 app with the middleware', async () => {
  const { default: express } = await import('express');
  const app = express();
  app.use(clikgateMiddleware(null));
  app.get('/x', (req, res) => {
    res.json({ clickId: req.clikgate.clickId });
  });
  const r = await serve(app as unknown as (req: IncomingMessage, res: ServerResponse) => void, `/x?cgid=${CLICK}`);
  assert.deepEqual(JSON.parse(r.body), { clickId: CLICK });
  assert.equal(r.setCookie.length, 2);
});

test('fastify plugin (Fastify 5 needs Node 20+)', { skip: major < 20 }, async () => {
  const { default: Fastify } = await import('fastify');
  const { clikgatePlugin } = await import('../../src/fastify.js');
  const app = Fastify();
  await app.register(clikgatePlugin, {});
  app.get('/x', async (request) => ({ clickId: request.clikgate.clickId }));
  const res = await app.inject({ method: 'GET', url: `/x?cgid=${CLICK}`, headers: { 'x-forwarded-proto': 'https' } });
  assert.deepEqual(res.json(), { clickId: CLICK });
  assert.match(String(res.headers['set-cookie']), /^_cg_cgid=/);
  const viaCookie = await app.inject({ method: 'GET', url: '/x', headers: { cookie: `_cg_cgid=${CLICK}` } });
  assert.deepEqual(viaCookie.json(), { clickId: CLICK });
  await app.close();
});

test('next proxy (Next 16 needs Node 20.9+)', { skip: major < 20 }, async () => {
  const { NextRequest } = await import('next/server.js');
  const { clikgateProxy, getClickId } = await import('../../src/next.js');
  const res = clikgateProxy(new NextRequest(`https://shop.example.com/landing?cgid=${CLICK}`));
  const cookies = res.headers.getSetCookie();
  assert.match(cookies[0] ?? '', /^_cg_cgid=clk_[0-9A-Z]{26}; Path=\/; Max-Age=2592000; SameSite=Lax; Secure$/);
  assert.equal(cookies[1], '_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure');
  assert.equal(res.headers.get('x-middleware-next'), '1');
  assert.equal(getClickId({ get: () => ({ value: CLICK }) }), CLICK);
  assert.equal(getClickId({ get: () => ({ value: 'nope' }) }), null);
});
