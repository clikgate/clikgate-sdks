import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolveProxy, nodeTransport } from '../../src/transport.js';
import { NetworkError, TimeoutError } from '../../src/index.js';

test('resolveProxy honours the option, the environment and NO_PROXY', () => {
  const t = new URL('https://api.clikgate.com/v1/x');
  assert.equal(resolveProxy(t, false, { HTTPS_PROXY: 'http://p:8080' }), null);
  assert.equal(resolveProxy(t, undefined, { HTTPS_PROXY: 'http://p:8080' })?.host, 'p:8080');
  assert.equal(resolveProxy(t, undefined, { HTTPS_PROXY: 'http://p:8080', NO_PROXY: '.clikgate.com' }), null);
  assert.equal(resolveProxy(t, 'http://u:s@corp:3128', {})?.username, 'u');
  assert.equal(resolveProxy(new URL('http://localhost:1/x'), undefined, { HTTP_PROXY: 'http://p:1' }), null);
});

test('an HTTP proxy receives absolute-form requests with Proxy-Authorization', async () => {
  let seen: { url?: string; auth?: string } = {};
  const proxy = createServer((req, res) => {
    seen = { url: req.url, auth: req.headers['proxy-authorization'] };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const port = (proxy.address() as { port: number }).port;
  try {
    const send = nodeTransport(`http://user:pw@127.0.0.1:${port}`);
    const res = await send({ method: 'GET', url: 'http://example.test/v1/ping', headers: {}, timeoutMs: 2000 });
    assert.equal(res.status, 200);
    assert.equal(seen.url, 'http://example.test/v1/ping');
    assert.equal(seen.auth, `Basic ${Buffer.from('user:pw').toString('base64')}`);
  } finally {
    proxy.close();
  }
});

test('the CONNECT tunnel is attempted for https targets', async () => {
  let connectTarget = '';
  const proxy = createServer();
  proxy.on('connect', (req, socket) => {
    connectTarget = req.url ?? '';
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
  const port = (proxy.address() as { port: number }).port;
  try {
    const send = nodeTransport(`http://127.0.0.1:${port}`);
    await assert.rejects(send({ method: 'GET', url: 'https://api.clikgate.com/v1/x', headers: {}, timeoutMs: 2000 }), NetworkError);
    assert.equal(connectTarget, 'api.clikgate.com:443');
  } finally {
    proxy.close();
  }
});

test('timeouts and refused connections map to typed errors', async () => {
  const slow = createServer(() => undefined);
  await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
  const port = (slow.address() as { port: number }).port;
  try {
    const send = nodeTransport(false);
    await assert.rejects(send({ method: 'GET', url: `http://127.0.0.1:${port}/`, headers: {}, timeoutMs: 100 }), TimeoutError);
  } finally {
    slow.closeAllConnections?.();
    slow.close();
  }
  await assert.rejects(nodeTransport(false)({ method: 'GET', url: 'http://127.0.0.1:1/', headers: {}, timeoutMs: 15_000 }), NetworkError); // Windows refuses slowly
});
