#!/usr/bin/env node
// Clikgate server SDK conformance mock server. Zero dependencies, Node 18+.
//
//   node server/conformance/mock-server/server.mjs [--port 0] [--host 127.0.0.1] [--cases <dir>]
//
// Prints one line when ready:  CLIKGATE_MOCK_READY {"port":53121,"cases":152}
// Control API under /__control/ (see ../README.md); every other request is recorded and answered
// from the current case's scripted `responses`, in order.

import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge } from './judge.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const casesDir = resolve(opt('cases', join(here, '..', 'cases')));
const host = opt('host', '127.0.0.1');
const port = Number(opt('port', '0'));

// Defaults every case's client gets (runners receive the merged, explicit object)
const CLIENT_DEFAULTS = {
  api_key: 'cg_test_conformance0000000000',
  timeout_ms: 2000,
  max_retries: 3,
  send_mode: 'sync',
  private_mode: false,
  click_id_param: null,
  batch_size: 100,
  flush_interval_ms: 3_600_000,
  max_queue_size: 10_000,
  shutdown_hooks: false,
};

export function loadCases(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const cases = [];
  const seen = new Set();
  for (const file of files) {
    const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const c of doc.cases) {
      if (seen.has(c.id)) throw new Error(`duplicate case id ${c.id}`);
      seen.add(c.id);
      cases.push({ ...c, suite: doc.suite, file });
    }
  }
  return cases;
}

const cases = loadCases(casesDir);
const byId = new Map(cases.map((c) => [c.id, c]));

function runnerView(c, baseUrl) {
  const client = { ...CLIENT_DEFAULTS, ...(c.client || {}) };
  if (client.base_url === undefined) client.base_url = baseUrl + (c.base_url_suffix || '');
  else client.base_url = String(client.base_url).replace('{mock}', baseUrl);
  return {
    id: c.id,
    suite: c.suite,
    file: c.file,
    description: c.description,
    languages: c.languages || null,
    client,
    env: c.env || {},
    random: c.random || [0.5],
    now_ms: c.now_ms ?? 1_793_016_000_000, // 2026-10-26T12:00:00Z
    steps: c.steps.map((s) => ({ call: s.call, args: s.args || {} })),
  };
}

const state = { current: null, queue: [], recorded: [], results: new Map() };

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function parseQuery(search) {
  const q = {};
  for (const [k, v] of new URLSearchParams(search)) {
    if (k in q) q[k] = Array.isArray(q[k]) ? [...q[k], v] : [q[k], v];
    else q[k] = v;
  }
  return q;
}

async function control(req, res, url, baseUrl) {
  const route = url.pathname.slice('/__control'.length);
  if (req.method === 'GET' && route === '/cases') {
    const lang = url.searchParams.get('language');
    const list = cases.filter((c) => !lang || !c.languages || c.languages.includes(lang)).map((c) => runnerView(c, baseUrl));
    return sendJson(res, 200, { cases: list });
  }
  if (req.method === 'POST' && route === '/start') {
    const { case_id: id } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const c = byId.get(id);
    if (!c) return sendJson(res, 404, { error: `unknown case ${id}` });
    state.current = c;
    state.queue = [...(c.responses || [])];
    state.recorded = [];
    return sendJson(res, 200, runnerView(c, baseUrl));
  }
  if (req.method === 'POST' && route === '/finish') {
    const outcome = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const c = byId.get(outcome.case_id);
    if (!c || state.current !== c) return sendJson(res, 409, { error: `case ${outcome.case_id} is not the started case` });
    // give in-flight (abandoned) requests a moment to land so they are counted
    await new Promise((r) => setTimeout(r, 20));
    let failures;
    try {
      failures = judge({ ...c, client: runnerView(c, baseUrl).client }, state.recorded, outcome);
    } catch (err) {
      failures = [`the judge crashed (malformed outcome?): ${err && err.stack ? err.stack : err}`];
    }
    if (state.queue.length > 0) failures.push(`${state.queue.length} scripted responses were never requested`);
    const ok = failures.length === 0;
    state.results.set(c.id, { ok, failures, language: outcome.language });
    state.current = null;
    return sendJson(res, 200, { case_id: c.id, ok, failures });
  }
  if (req.method === 'GET' && route === '/requests') {
    return sendJson(res, 200, { requests: state.recorded, unconsumed: state.queue.length });
  }
  if (req.method === 'GET' && route === '/report') {
    const rows = [...state.results.entries()].map(([id, r]) => ({ id, ...r }));
    return sendJson(res, 200, { total: rows.length, passed: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok) });
  }
  if (req.method === 'POST' && route === '/shutdown') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 10);
    return undefined;
  }
  return sendJson(res, 404, { error: 'unknown control route' });
}

const server = createServer(async (req, res) => {
  const baseUrl = `http://${host}:${server.address().port}`;
  const url = new URL(req.url, baseUrl);
  if (url.pathname.startsWith('/__control/')) return control(req, res, url, baseUrl);

  const body = await readBody(req);
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  const rawPath = req.url;
  state.recorded.push({
    method: req.method,
    raw_path: rawPath,
    path: rawPath.split('?')[0],
    query: parseQuery(url.search),
    headers,
    body_text: body.toString('utf8'),
    body_base64: body.toString('base64'),
  });

  const r = state.queue.shift();
  if (!r) {
    return sendJson(res, 500, { error: { type: 'server', code: 'mock_unexpected_request', message: `No scripted response for ${req.method} ${rawPath}`, param: null, request_id: 'req_mock' } });
  }
  if (r.action === 'reset') {
    req.socket.destroy();
    return undefined;
  }
  const respond = () => {
    if (res.destroyed || res.writableEnded) return;
    const h = { ...(r.headers || {}) };
    let payload = Buffer.alloc(0);
    if (r.json !== undefined) {
      payload = Buffer.from(JSON.stringify(r.json));
      if (!Object.keys(h).some((k) => k.toLowerCase() === 'content-type')) h['content-type'] = 'application/json';
    } else if (r.body_text !== undefined) payload = Buffer.from(r.body_text, 'utf8');
    else if (r.body_base64 !== undefined) payload = Buffer.from(r.body_base64, 'base64');
    h['content-length'] = payload.length;
    res.writeHead(r.status ?? 200, h);
    res.end(payload);
  };
  if (r.delay_ms) {
    const timer = setTimeout(respond, r.delay_ms);
    res.on('close', () => clearTimeout(timer));
  } else respond();
  return undefined;
});

server.keepAliveTimeout = 60_000;
server.headersTimeout = 65_000;
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) server.listen(port, host, () => {
  process.stdout.write(`CLIKGATE_MOCK_READY ${JSON.stringify({ port: server.address().port, cases: cases.length })}\n`);
});
