// The Node conformance runner (server/conformance/README.md, "Runner protocol").
// Starts the shared mock server, runs every case for language "node", and lets the mock judge each one.
//
//   node .test-dist/test/conformance/runner.js [--filter <substring>] [--verbose]

import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Clikgate, ClikgateError, formatValue, hashForAds, type ClikgateOptions, type ErrorContext, type GoalOptions, type PaymentConfirmParams, type PaymentHelperOptions } from '../../src/index.js';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface RunnerCase {
  id: string;
  description: string;
  client: Record<string, Json>;
  random: number[];
  now_ms: number;
  steps: Array<{ call: string; args: Record<string, Json> }>;
}

const here = dirname(fileURLToPath(import.meta.url));
// .test-dist/test/conformance → server/node → server/conformance
const mockPath = resolve(here, '..', '..', '..', '..', 'conformance', 'mock-server', 'server.mjs');
const argv = process.argv.slice(2);
const filter = argv.includes('--filter') ? argv[argv.indexOf('--filter') + 1] : undefined;
const verbose = argv.includes('--verbose');

for (const k of ['CLIKGATE_API_KEY', 'CLIKGATE_BASE_URL', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete process.env[k];

function startMock(): Promise<{ child: ChildProcess; base: string }> {
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [mockPath, '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      const m = /^CLIKGATE_MOCK_READY (.*)$/.exec(line);
      if (m) ok({ child, base: `http://127.0.0.1:${(JSON.parse(m[1]!) as { port: number }).port}` });
    });
    child.once('exit', (code) => fail(new Error(`mock server exited with ${code}`)));
  });
}

async function control<T>(base: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}/__control${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`control ${path}: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Decode the typed argument encodings of the case format. */
function decode(v: Json): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1) {
      const [k] = keys as [string];
      const x = v[k];
      if (k === '$decimal') return String(x); // Node has no decimal type: decimal strings
      if (k === '$float') return Number(x);
      if (k === '$bigint') return BigInt(String(x));
      if (k === '$datetime') return new Date(String(x));
      if (k === '$bytes_base64') return Buffer.from(String(x), 'base64');
    }
    return Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, decode(vv)]));
  }
  return v;
}

const CAMEL: Record<string, string> = { click_id: 'clickId', is_first: 'isFirst', occurred_at: 'occurredAt', kept_by: 'keptBy', browser_engine: 'browserEngine', hashed_email: 'hashedEmail', hashed_phone_e164: 'hashedPhoneE164', hashed_phone_digits: 'hashedPhoneDigits' };
function goalOptions(args: Record<string, unknown>): GoalOptions {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === 'key' || k === 'goal') continue;
    out[CAMEL[k] ?? k] = v;
  }
  return out as unknown as GoalOptions;
}

const PAY_CAMEL: Record<string, string> = { amount_minor: 'amountMinor', occurred_at: 'occurredAt', click_id: 'clickId' };
function confirmParams(args: Record<string, unknown>): PaymentConfirmParams {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (k !== 'idempotency_key') out[PAY_CAMEL[k] ?? k] = v;
  return out as unknown as PaymentConfirmParams;
}
function helperCall(client: Clikgate, a: Record<string, unknown>, send: boolean): unknown {
  const opts: PaymentHelperOptions = { goal: a.goal as string | undefined, clickId: a.click_id as string | undefined };
  const p = client.payments;
  const g = a.gateway as string;
  const name = `${g[0]!.toUpperCase()}${g.slice(1)}` as 'Paystack' | 'Flutterwave' | 'Monnify' | 'Stripe';
  return send ? p[`from${name}`](a.response, opts) : { value: p[`buildFrom${name}`](a.response, opts) };
}

function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof ClikgateError) {
    const e = err as ClikgateError & { retryAfter?: number | null; field?: string; index?: number | null };
    return {
      class: e.constructor.name,
      code: e.code,
      http_status: e.httpStatus,
      param: e.param,
      request_id: e.requestId,
      type: e.type,
      retry_after: e.retryAfter ?? null,
      field: e.field ?? null,
      index: e.index ?? null,
      allowed: (e as { allowed?: string[] | null }).allowed ?? null,
      doc_url: (e as { docUrl?: string | null }).docUrl ?? null,
      required_plan: (e as { requiredPlan?: string | null }).requiredPlan ?? null,
      limit: (e as { limit?: number | null }).limit ?? null,
      message: e.message,
    };
  }
  const e = err as Error;
  return { class: e?.constructor?.name ?? 'Error', code: null, message: String(e?.message ?? e) };
}

function fakeResponse(existing: string[]) {
  const headers = new Map<string, string[]>([['set-cookie', [...existing]]]);
  return {
    headers,
    getHeader: (n: string) => headers.get(n.toLowerCase()),
    setHeader: (n: string, v: string | string[]) => headers.set(n.toLowerCase(), Array.isArray(v) ? v : [v]),
  };
}

async function runCase(c: RunnerCase): Promise<Record<string, unknown>> {
  let now = c.now_ms;
  let draw = 0;
  const sleeps: number[] = [];
  const warnings: string[] = [];
  const logs: string[] = [];
  const onError: Array<Record<string, unknown>> = [];
  const cl = c.client;
  const log = (message: string, context?: Record<string, unknown>) => {
    logs.push(`${message} ${context ? JSON.stringify(context) : ''}`);
  };
  const options: ClikgateOptions = {
    apiKey: (cl.api_key as string | null) ?? undefined,
    baseUrl: cl.base_url as string,
    timeout: cl.timeout_ms as number,
    maxRetries: cl.max_retries as number,
    sendMode: cl.send_mode as 'background' | 'sync',
    privateMode: cl.private_mode as 'auto' | boolean,
    clickIdParam: (cl.click_id_param as string | null) ?? undefined,
    batchSize: cl.batch_size as number,
    flushInterval: cl.flush_interval_ms as number,
    maxQueueSize: cl.max_queue_size as number,
    shutdownHooks: false,
    logger: {
      warn: (m, ctx) => {
        if (ctx && typeof ctx.code === 'string') warnings.push(ctx.code);
        log(m, ctx);
      },
      error: log,
    },
    onError: (error: ClikgateError, ctx: ErrorContext) => {
      onError.push({ ...serialiseError(error), events: ctx.events, dropped: ctx.dropped, operation: ctx.operation });
    },
    clock: {
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    },
    random: () => {
      const r = c.random[draw % c.random.length] ?? 0.5;
      draw += 1;
      return r;
    },
  };

  let client: Clikgate;
  try {
    client = new Clikgate(options);
  } catch (err) {
    return { language: 'node', construct_error: serialiseError(err), steps: [], sleeps_ms: sleeps, warnings, logs, on_error: onError };
  }

  const steps: Array<Record<string, unknown>> = [];
  for (const step of c.steps) {
    const a = decode(step.args) as Record<string, unknown>;
    const reqOpts = a.idempotency_key ? { idempotencyKey: a.idempotency_key as string } : {};
    try {
      let result: unknown = null;
      switch (step.call) {
        case 'client.mode':
          result = { value: client.mode };
          break;
        case 'goal':
          client.goal(a.key as string, goalOptions(a));
          break;
        case 'goals.send':
          result = await client.goals.send(a.key as string, goalOptions(a), reqOpts);
          break;
        case 'goals.send_batch':
          result = await client.goals.sendBatch((a.events as Array<Record<string, unknown>>).map((e) => ({ goal: e.goal as string, ...goalOptions(e) })));
          break;
        case 'goals.reverse':
          result = await client.goals.reverse(a.key as string, a.reference as string, { value: a.value as string | undefined, reason: a.reason as string | undefined });
          break;
        case 'flush':
          result = { value: await client.flush((a.timeout_ms as number | undefined) ?? 10_000) };
          break;
        case 'close':
          result = { value: await client.close((a.timeout_ms as number | undefined) ?? 10_000) };
          break;
        case 'advance_clock':
          now += a.ms as number;
          break;
        case 'config.get':
          result = await client.config();
          break;
        case 'conversions.create':
          result = await client.conversions.create(a.params as Record<string, unknown>, reqOpts);
          break;
        case 'conversions.reverse':
          result = await client.conversions.reverse(a.id as string, (a.params as Record<string, unknown> | undefined) ?? {});
          break;
        case 'links.create':
          result = await client.links.create(a.params as Record<string, unknown>, reqOpts);
          break;
        case 'links.get':
          result = await client.links.get(a.id as string);
          break;
        case 'links.update':
          result = await client.links.update(a.id as string, a.params as Record<string, unknown>, reqOpts);
          break;
        case 'links.list':
          result = { items: await client.links.list((a.params as Record<string, unknown> | undefined) ?? {}).toArray((a.max_items as number | undefined) ?? undefined) };
          break;
        case 'links.list_page':
          result = await client.links.listPage((a.params as Record<string, unknown> | undefined) ?? {});
          break;
        case 'links.qr': {
          const { id, ...q } = a;
          const qr = await client.links.qr(id as string, q as Record<string, never>);
          result = { content_type: qr.contentType, bytes_length: qr.data.byteLength };
          break;
        }
        case 'clicks.get':
          result = await client.clicks.get(a.id as string);
          break;
        case 'webhooks.verify':
          result = client.webhooks.verify(a.raw_body as string, a.header as string, a.secret as string, { tolerance: a.tolerance as number, now: a.now as number });
          break;
        case 'webhooks.verify_any':
          result = client.webhooks.verifyAny(a.raw_body as string, a.header as string, a.secrets as string[], { tolerance: a.tolerance as number, now: a.now as number });
          break;
        case 'click_ids.is_valid':
          result = { value: client.clickIds.isValid(a.id) };
          break;
        case 'click_ids.from_request': {
          const r = a.request as { url: string; headers: Record<string, string> };
          result = { value: client.clickIds.fromRequest({ url: r.url, headers: r.headers }) };
          break;
        }
        case 'click_ids.cookie_header':
          result = { value: client.clickIds.cookieHeader(a.id as string, { days: a.days as number | undefined, secure: a.secure as boolean | undefined, domain: a.domain as string | undefined }) };
          break;
        case 'click_ids.persist': {
          const res = fakeResponse((a.existing_set_cookie as string[] | undefined) ?? []);
          client.clickIds.persist(res, a.id as string, { days: a.days as number | undefined, secure: a.secure as boolean | undefined, domain: a.domain as string | undefined });
          result = { set_cookie: res.headers.get('set-cookie') };
          break;
        }
        case 'click_ids.context': {
          const r = a.request as { url: string; headers: Record<string, string> };
          const ctx = client.clickIds.context({ url: r.url, headers: r.headers });
          result = { click_id: ctx.clickId, kept_by: ctx.keptBy, browser_engine: ctx.browserEngine, platform: ctx.platform };
          break;
        }
        case 'click_ids.keep': {
          const r = a.request as { method: string; url: string; headers: Record<string, string>; body?: string };
          const route = client.clickIds.keepRoute({ days: a.days as number | undefined, secure: a.secure as boolean | undefined, domain: a.domain as string | undefined });
          const hasBody = r.body !== undefined && r.body !== '' && r.method !== 'GET' && r.method !== 'HEAD';
          const res = await route(new Request(r.url, { method: r.method, headers: r.headers, body: hasBody ? r.body : undefined }));
          const out: Record<string, unknown> = {
            status: res.status,
            cache_control: res.headers.get('cache-control'),
            set_cookie: res.headers.getSetCookie(),
            body: await res.text(),
            location: res.headers.get('location'),
          };
          if (res.headers.has('allow')) out.allow = res.headers.get('allow');
          result = out;
          break;
        }
        case 'click_ids.from_payment_metadata':
          result = { value: client.clickIds.fromPaymentMetadata(a.payload) };
          break;
        case 'hash_for_ads': {
          const h = hashForAds({ email: a.email as string | undefined, phone: a.phone as string | undefined });
          result = Object.fromEntries(
            ([['hashed_email', h.hashedEmail], ['hashed_phone_e164', h.hashedPhoneE164], ['hashed_phone_digits', h.hashedPhoneDigits]] as const).filter(([, v]) => v !== undefined),
          );
          break;
        }
        case 'identify_user':
          result = await client.identifyUser(
            {
              clickId: a.click_id as string | undefined,
              appId: a.app_id as string | undefined,
              installationId: a.installation_id as string | undefined,
              customerId: a.customer_id as string | undefined,
              label: a.label as string | undefined,
            },
            reqOpts,
          );
          break;
        case 'payments.confirm':
          result = await client.payments.confirm(confirmParams(a), reqOpts);
          break;
        case 'payments.from':
          result = await helperCall(client, a, true);
          break;
        case 'payments.build':
          result = helperCall(client, a, false);
          break;
        case 'money.format':
          result = {
            value: formatValue(a.value as string, () => {
              warnings.push('inexact_number');
            }),
          };
          break;
        default:
          throw new Error(`runner: unknown call ${step.call}`);
      }
      steps.push({ result: result === undefined ? null : JSON.parse(JSON.stringify(result, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) });
    } catch (err) {
      steps.push({ error: serialiseError(err) });
    }
  }
  const outcome = { language: 'node', steps, sleeps_ms: sleeps, warnings, logs, on_error: onError };
  (outcome as Record<string, unknown>).close = () => client.close(1000);
  return outcome;
}

async function main(): Promise<void> {
  const { child, base } = await startMock();
  let failed = 0;
  let passed = 0;
  try {
    const { cases } = await control<{ cases: RunnerCase[] }>(base, '/cases?language=node');
    for (const c of cases) {
      if (filter && !c.id.includes(filter)) continue;
      const started = await control<RunnerCase>(base, '/start', { case_id: c.id });
      const outcome = await runCase(started);
      const close = outcome.close as (() => Promise<boolean>) | undefined;
      delete outcome.close;
      const verdict = await control<{ ok: boolean; failures: string[] }>(base, '/finish', { case_id: c.id, ...outcome });
      if (close) await close();
      if (verdict.ok) {
        passed += 1;
        if (verbose) console.log(`ok   ${c.id}`);
      } else {
        failed += 1;
        console.log(`FAIL ${c.id}: ${c.description}\n  - ${verdict.failures.join('\n  - ')}`);
      }
    }
  } finally {
    child.kill();
  }
  console.log(`\nconformance (node): ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0 || passed === 0) process.exitCode = 1;
}

void main();
