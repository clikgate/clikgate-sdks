import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ConflictError,
  INSTALLATION_HEADER,
  InvalidRequestError,
  installationFromRequest,
  parseInstallationHeader,
} from '../../src/index.js';
import { clikgateMiddleware } from '../../src/express.js';
import { capture, client } from './helpers.js';

const APP = 'app_01JCK8Z9V7Q4M2N6P8R0S2T4AP';
const INSTALLATION = '6a1f0c2e-0000-4000-8000-000000000001';
const HEADER = `${APP}:${INSTALLATION}`;
const PARSED = { appId: APP, installationId: INSTALLATION };
const major = Number(process.versions.node.split('.')[0]);

test('parseInstallationHeader accepts only <app_id>:<lowercase uuid>, trimmed, at most 128 characters', () => {
  assert.deepEqual(parseInstallationHeader(HEADER), PARSED);
  assert.deepEqual(parseInstallationHeader(`  ${HEADER}\t`), PARSED);
  for (const bad of [
    `${APP}:${INSTALLATION.toUpperCase()}`,
    `${APP.toLowerCase()}:${INSTALLATION}`,
    `${HEADER}:x`,
    `${APP}::${INSTALLATION}`,
    `${APP}${INSTALLATION}`,
    `${APP}:`,
    `:${INSTALLATION}`,
    `cli_01JCK8Z9V7Q4M2N6P8R0S2T4AP:${INSTALLATION}`,
    `${' '.repeat(70)}${HEADER}`,
    `${HEADER}\n${HEADER}`,
    `${HEADER}, ${HEADER}`,
    '',
    '   ',
    'x'.repeat(10_000),
  ]) {
    assert.equal(parseInstallationHeader(bad), null, bad.slice(0, 80));
  }
  for (const notAString of [null, undefined, 42, {}, [HEADER], Symbol('x')]) {
    assert.equal(parseInstallationHeader(notAString), null);
  }
  assert.equal(INSTALLATION_HEADER, 'Clikgate-Installation');
});

test('installationFromRequest reads the header from records, Fetch Headers and get() stores', () => {
  assert.deepEqual(installationFromRequest({ headers: { 'clikgate-installation': HEADER } }), PARSED);
  assert.deepEqual(installationFromRequest({ headers: { 'Clikgate-Installation': HEADER } }), PARSED);
  assert.deepEqual(installationFromRequest({ headers: new Headers({ 'Clikgate-Installation': HEADER }) }), PARSED);
  assert.deepEqual(installationFromRequest({ headers: { 'clikgate-installation': [HEADER] } }), PARSED);
  assert.equal(installationFromRequest({ headers: { 'clikgate-installation': [HEADER, HEADER] } }), null);
  const twice = new Headers();
  twice.append('Clikgate-Installation', HEADER);
  twice.append('Clikgate-Installation', HEADER);
  assert.equal(installationFromRequest({ headers: twice }), null);
  assert.equal(installationFromRequest({ headers: {} }), null);
  assert.equal(installationFromRequest({ headers: null }), null);
  assert.equal(installationFromRequest(null), null);
  const throwing = { headers: { get: () => { throw new Error('boom'); } } };
  assert.equal(installationFromRequest(throwing), null);
});

test('identifyUser: installation header, installationId without appId, explicit IDs win, bad headers ignored', async () => {
  const ok = { status: 200, json: { object: 'person_identified', person_id: 'per_1', label_ignored: null } };
  const { calls, fetchLike } = capture([ok, ok, ok, ok, ok]);
  const c = client(fetchLike);
  await c.identifyUser({ installation: ` ${HEADER} `, customerId: 'user_42' });
  await c.identifyUser({ installationId: INSTALLATION, customerId: 'user_42' });
  await c.identifyUser({ installation: HEADER, installationId: '6a1f0c2e-0000-4000-8000-000000000002', customerId: 'user_42' });
  await c.identifyUser({ installation: 'not-a-header', clickId: 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6' });
  await c.identifyUser({ appId: APP, installationId: INSTALLATION, customerId: 'user_42' });
  assert.deepEqual(JSON.parse(calls[0]!.body), { app_id: APP, installation_id: INSTALLATION, customer_id: 'user_42' });
  assert.deepEqual(JSON.parse(calls[1]!.body), { installation_id: INSTALLATION, customer_id: 'user_42' });
  assert.deepEqual(JSON.parse(calls[2]!.body), { installation_id: '6a1f0c2e-0000-4000-8000-000000000002', customer_id: 'user_42' });
  assert.deepEqual(JSON.parse(calls[3]!.body), { click_id: 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6' });
  assert.deepEqual(JSON.parse(calls[4]!.body), { app_id: APP, installation_id: INSTALLATION, customer_id: 'user_42' });
  await assert.rejects(c.identifyUser({ installation: 'not-a-header' }), (e: unknown) => e instanceof InvalidRequestError && e.param === 'click_id' && !e.message.includes('not-a-header'));
  await assert.rejects(c.identifyUser({ appId: APP }), (e: unknown) => e instanceof InvalidRequestError && e.param === 'installation_id');
  assert.equal(calls.length, 5);
});

test('identifyUser: 409 installation_in_several_apps is a ConflictError with param app_id', async () => {
  const { fetchLike } = capture([
    { status: 409, json: { error: { type: 'conflict', code: 'installation_in_several_apps', message: 'Send app_id.', param: 'app_id', request_id: 'req_1' } } },
  ]);
  await assert.rejects(
    client(fetchLike).identifyUser({ installationId: INSTALLATION, customerId: 'user_42' }),
    (e: unknown) => e instanceof ConflictError && e.code === 'installation_in_several_apps' && e.param === 'app_id' && e.httpStatus === 409,
  );
});

async function get(handler: (req: IncomingMessage, res: ServerResponse) => void, headers: Record<string, string>) {
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  try {
    return await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/me', headers }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

test('express middleware exposes req.clikgate.installation (null when missing or invalid)', async () => {
  const { default: express } = await import('express');
  const app = express();
  app.use(clikgateMiddleware(null));
  app.get('/me', (req, res) => {
    res.json({ installation: req.clikgate.installation });
  });
  const handler = app as unknown as (req: IncomingMessage, res: ServerResponse) => void;
  assert.deepEqual(JSON.parse((await get(handler, { 'Clikgate-Installation': HEADER })).body), { installation: PARSED });
  const bad = await get(handler, { 'Clikgate-Installation': 'x'.repeat(500) });
  assert.equal(bad.status, 200);
  assert.deepEqual(JSON.parse(bad.body), { installation: null });
  assert.deepEqual(JSON.parse((await get(handler, {})).body), { installation: null });
});

test('fastify plugin exposes request.clikgate.installation', { skip: major < 20 }, async () => {
  const { default: Fastify } = await import('fastify');
  const { clikgatePlugin } = await import('../../src/fastify.js');
  const app = Fastify();
  await app.register(clikgatePlugin, {});
  app.get('/me', async (request) => ({ installation: request.clikgate.installation }));
  const res = await app.inject({ method: 'GET', url: '/me', headers: { 'clikgate-installation': HEADER } });
  assert.deepEqual(res.json(), { installation: PARSED });
  const bad = await app.inject({ method: 'GET', url: '/me', headers: { 'clikgate-installation': `${APP}:${INSTALLATION.toUpperCase()}` } });
  assert.deepEqual(bad.json(), { installation: null });
  await app.close();
});

test('next getInstallation reads headers() and request.headers', { skip: major < 20 }, async () => {
  const { NextRequest } = await import('next/server.js');
  const { getInstallation } = await import('../../src/next.js');
  const req = new NextRequest('https://shop.example.com/api/login', { headers: { 'Clikgate-Installation': HEADER } });
  assert.deepEqual(getInstallation(req.headers), PARSED);
  assert.deepEqual(getInstallation(new Headers({ 'clikgate-installation': HEADER })), PARSED);
  assert.equal(getInstallation(new Headers({ 'clikgate-installation': 'nope' })), null);
  assert.equal(getInstallation(new Headers()), null);
  assert.equal(getInstallation(null), null);
});
