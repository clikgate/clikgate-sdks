import { ClickIds } from './click-ids.js';
import { ConfigCache } from './config.js';
import { Core, type OnError } from './core.js';
import { ConfigurationError, localError } from './errors.js';
import { guardPayload } from './guard.js';
import type { RequestOptions } from './http.js';
import { ApiClient } from './generated/index.js';
import { GoalQueue, Goals, asClikgateError, buildGoalWire, checkBeforeSend, type GoalOptions } from './goals.js';
import { Requester, systemClock, type Clock } from './http.js';
import { consoleLogger, type Logger } from './logger.js';
import { Payments } from './payments.js';
import { Clicks, Conversions, Links } from './resources.js';
import { registerShutdown, unregisterShutdown } from './shutdown.js';
import { fetchTransport, nodeTransport, type FetchLike, type Transport } from './transport.js';
import type { ServerSdkConfig } from './types.js';
import { userAgent } from './user-agent.js';
import { webhooks, type RawBody, type VerifyOptions } from './webhooks.js';

/** Client options (SPEC section 3). Every option is optional. */
/** `identifyUser()`: at least one of `clickId`, `appId` + `installationId`, `customerId`. */
export interface IdentifyUserParams {
  /** The Clikgate click ID you kept (`clk_…`). */
  clickId?: string | null;
  /** An app installation: the app's ID and the SDK's installation ID, together. */
  appId?: string | null;
  installationId?: string | null;
  /** Your customer ID. With a click or installation, links it to this customer. */
  customerId?: string | null;
  /** A label your team sees instead of the click ID (1–80 characters, `''` clears it). */
  label?: string | null;
}

/** The answer of `identifyUser()`. */
export interface PersonIdentified {
  object: 'person_identified';
  person_id: string;
  /** `plan`: below Growth the label isn't stored; `lower_rank`: a label your team set was kept. */
  label_ignored: 'plan' | 'lower_rank' | null;
}

export interface ClikgateOptions {
  /** `cg_live_…` or `cg_test_…`. Default: `process.env.CLIKGATE_API_KEY`. The mode comes from the prefix. */
  apiKey?: string;
  /** Default `process.env.CLIKGATE_BASE_URL`, else `https://api.clikgate.com`. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds (default 10 000). */
  timeout?: number;
  /** Retries for network errors, timeouts and HTTP 429, 500, 502, 503 and 504 (default 3, at most 10). */
  maxRetries?: number;
  /** `background` (default: `goal()` queues and batches) or `sync` (`goal()` sends at once). */
  sendMode?: 'background' | 'sync';
  /** `auto` (default: follow the organisation's setting from `/v1/server-sdk/config`), `true` (always guard), `false` (never guard locally). */
  privateMode?: 'auto' | boolean;
  /** The click-ID query parameter (default: from config, else `cgid`). */
  clickIdParam?: string;
  /** A console-compatible logger. Default: `console`, warnings and errors only. */
  logger?: Logger;
  /** Called for failures that can't be thrown (background sends, every `goal()`). */
  onError?: OnError;
  /** A `fetch`-compatible function to send requests with (proxies, mTLS, tracing). Default: built-in node:https. */
  httpClient?: FetchLike;
  /** An `http(s)://user:pass@host:port` proxy, or `false` to ignore `HTTPS_PROXY`/`HTTP_PROXY`. Default: the environment. */
  proxy?: string | false;
  /** Background batch size, 1–500 (default 100). */
  batchSize?: number;
  /** Background flush interval in ms (default 1000). */
  flushInterval?: number;
  /** Background queue bound (default 10 000); when full, the oldest event is dropped. */
  maxQueueSize?: number;
  /** Flush on `beforeExit`, `SIGTERM` and `SIGINT` (default true). */
  shutdownHooks?: boolean;
  /** Advanced (tests): replace the clock and sleep. */
  clock?: Clock;
  /** Advanced (tests): the random source for backoff jitter, in [0, 1). */
  random?: () => number;
}

const KEY = /^cg_(live|test)_[A-Za-z0-9_]+$/;
const PARAM = /^[A-Za-z0-9_]{1,32}$/;
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

function keyType(k: string): string {
  if (k.startsWith('cg_sdk_')) return 'a mobile SDK key (cg_sdk_…)';
  if (k.startsWith('cg_site_')) return 'a web script site key (cg_site_…)';
  if (k.startsWith('cg_cli_')) return 'a setup command token (cg_cli_…)';
  return 'not a Clikgate server API key';
}

function int(name: string, v: number | undefined, def: number, min: number, max: number): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ConfigurationError({ message: `${name} must be a number from ${min} to ${max}.`, code: 'invalid_option', param: name });
  return v;
}

/**
 * The Clikgate client. Create one and reuse it; it is safe to share across requests.
 *
 * @example
 * import { Clikgate } from '@clikgate/node';
 * const clikgate = new Clikgate();   // reads CLIKGATE_API_KEY
 * clikgate.goal('account_opened', { clickId, reference: 'APP-55231', value: '2000000' });
 */
export class Clikgate {
  /** `live` or `test`, from the API key prefix. */
  readonly mode: 'live' | 'test';
  /** Goal events. */
  readonly goals: Goals;
  /** Conversions (older API). */
  readonly conversions: Conversions;
  /** Payments your server has verified: `confirm`, `fromPaystack`, `fromFlutterwave`, `fromMonnify`, `fromStripe`. */
  readonly payments: Payments;
  /** Links. */
  readonly links: Links;
  /** Clicks. */
  readonly clicks: Clicks;
  /** Click-ID helpers using this client's `clickIdParam` (or the organisation's from config). */
  readonly clickIds: ClickIds;
  /** Every API-key operation, generated from openapi.json ("advanced"). */
  readonly api: ApiClient;
  /** Webhook verification (also available without a client: `import { webhooks } from '@clikgate/node'`). */
  readonly webhooks: {
    verify: typeof webhooks.verify;
    verifyAny: typeof webhooks.verifyAny;
  };

  private readonly core: Core;
  private readonly queue: GoalQueue;
  private readonly sendMode: 'background' | 'sync';
  private closed = false;
  private readonly shutdownEntry: { busy(): boolean; flush(ms: number): Promise<boolean> } | null;

  constructor(options: ClikgateOptions = {}) {
    const apiKey = options.apiKey ?? process.env.CLIKGATE_API_KEY;
    if (!apiKey) throw new ConfigurationError({ message: 'No API key: pass { apiKey } or set CLIKGATE_API_KEY (cg_live_… or cg_test_…).', code: 'missing_api_key', param: 'apiKey' });
    const m = KEY.exec(apiKey);
    if (!m) throw new ConfigurationError({ message: `The API key is ${keyType(apiKey)}. Server SDKs need a cg_live_… or cg_test_… API key from Developers → API keys.`, code: 'invalid_api_key', param: 'apiKey' });
    this.mode = m[1] as 'live' | 'test';

    const baseUrl = (options.baseUrl ?? process.env.CLIKGATE_BASE_URL ?? 'https://api.clikgate.com').replace(/\/+$/, '');
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ConfigurationError({ message: 'baseUrl is not a URL.', code: 'invalid_option', param: 'baseUrl' });
    }
    if (!(parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOCAL.has(parsed.hostname)))) {
      throw new ConfigurationError({ message: 'baseUrl must use https:// (http:// only for localhost).', code: 'invalid_option', param: 'baseUrl' });
    }
    const timeoutMs = int('timeout', options.timeout, 10_000, 1, 600_000);
    const maxRetries = int('maxRetries', options.maxRetries, 3, 0, 10);
    const batchSize = int('batchSize', options.batchSize, 100, 1, 500);
    const flushIntervalMs = int('flushInterval', options.flushInterval, 1000, 1, 3_600_000);
    const maxQueueSize = int('maxQueueSize', options.maxQueueSize, 10_000, 1, 1_000_000);
    if (options.clickIdParam !== undefined && !PARAM.test(options.clickIdParam)) {
      throw new ConfigurationError({ message: 'clickIdParam must be 1-32 letters, digits or underscores.', code: 'invalid_option', param: 'clickIdParam' });
    }
    const sendMode = options.sendMode ?? 'background';
    if (sendMode !== 'background' && sendMode !== 'sync') throw new ConfigurationError({ message: "sendMode must be 'background' or 'sync'.", code: 'invalid_option', param: 'sendMode' });
    const privateMode = options.privateMode ?? 'auto';
    if (privateMode !== 'auto' && privateMode !== true && privateMode !== false) throw new ConfigurationError({ message: "privateMode must be 'auto', true or false.", code: 'invalid_option', param: 'privateMode' });

    const clock = options.clock ?? systemClock;
    const logger = options.logger ?? consoleLogger;
    const transport: Transport = options.httpClient ? fetchTransport(options.httpClient) : nodeTransport(options.proxy);
    const requester = new Requester({ apiKey, baseUrl, timeoutMs, maxRetries, userAgent: userAgent(), transport, clock, random: options.random ?? Math.random });
    const configCache = new ConfigCache(requester, clock, logger, timeoutMs);
    this.core = new Core(requester, logger, clock, privateMode, configCache, options.onError);
    this.sendMode = sendMode;
    this.queue = new GoalQueue(this.core, { batchSize, flushIntervalMs, maxQueueSize });

    this.goals = new Goals(this.core);
    this.conversions = new Conversions(this.core);
    this.payments = new Payments(this.core);
    this.links = new Links(this.core);
    this.clicks = new Clicks(this.core);
    const explicitParam = options.clickIdParam;
    this.clickIds = new ClickIds(() => explicitParam ?? configCache.peek()?.click_id_param ?? 'cgid');
    this.api = new ApiClient(requester);
    this.webhooks = {
      verify: (rawBody: RawBody, header: string | null | undefined, secret: string, o: VerifyOptions = {}) =>
        webhooks.verify(rawBody, header, secret, { now: Math.floor(clock.now() / 1000), ...o }),
      verifyAny: (rawBody: RawBody, header: string | null | undefined, secrets: string[], o: VerifyOptions = {}) =>
        webhooks.verifyAny(rawBody, header, secrets, { now: Math.floor(clock.now() / 1000), ...o }),
    } as Clikgate['webhooks'];

    if (options.shutdownHooks ?? true) {
      this.shutdownEntry = { busy: () => this.queue.busy, flush: (ms) => this.flush(ms) };
      registerShutdown(this.shutdownEntry);
    } else this.shutdownEntry = null;
  }

  /**
   * Record a goal without waiting. **Never throws**: failures go to `logger` and `onError`.
   * In background mode the event is queued and sent in batches; call `await clikgate.flush()`
   * before a serverless function returns.
   *
   * @example
   * clikgate.goal('account_opened', { clickId: application.clickId, reference: 'APP-55231', value: '2000000', currency: 'NGN' });
   */
  goal(key: string, options: GoalOptions): void {
    const shown = () => ({ goal: String(key), reference: this.core.shownReference(options?.reference) });
    if (this.closed) {
      this.core.report(localError('client_closed', 'This Clikgate client is closed.'), { operation: 'goal', events: [shown()], dropped: true });
      return;
    }
    let wire;
    try {
      wire = buildGoalWire(this.core, key, options);
    } catch (err) {
      this.core.report(asClikgateError(err), { operation: 'goal', events: [shown()], dropped: true });
      return;
    }
    if (this.sendMode === 'background') {
      this.queue.enqueue(wire);
      return;
    }
    const w = wire;
    const p = (async () => {
      try {
        const state = await this.core.guardState();
        checkBeforeSend(this.core, state, w);
        await this.core.requester.request({ method: 'POST', path: '/v1/goals/events', body: w });
      } catch (err) {
        this.core.report(asClikgateError(err), { operation: 'goal', events: [shown()], dropped: true });
      }
    })();
    this.queue.track(p);
  }

  /**
   * Tell Clikgate who a person is (`POST /v1/people/identify`): a click (`clickId`), an app installation (`appId` +
   * `installationId`) or your `customerId`, at least one. With a click or installation, `customerId` links it to that
   * customer. `label` is what your team sees instead of the click ID (1–80 characters, `''` clears it; Growth and
   * up). Always verified (your server), so it also satisfies a referral program's `require_identity_token`.
   * In private mode `customerId` is refused locally (the guard) and `label` needs "Allow labels in private mode".
   *
   * @example
   * await clikgate.identifyUser({ clickId: order.clickId, customerId: 'user_42', label: 'Ada (VIP)' });
   */
  async identifyUser(params: IdentifyUserParams, requestOptions: RequestOptions = {}): Promise<PersonIdentified> {
    const p = (params ?? {}) as IdentifyUserParams;
    if ((p.appId == null) !== (p.installationId == null)) {
      throw localError('invalid_request', 'Send appId and installationId together.', p.appId == null ? 'app_id' : 'installation_id');
    }
    if (p.clickId == null && p.installationId == null && p.customerId == null) {
      throw localError('invalid_request', 'Send clickId, appId + installationId, or customerId.', 'click_id');
    }
    const body: Record<string, unknown> = {};
    if (p.clickId != null) body.click_id = p.clickId;
    if (p.appId != null) body.app_id = p.appId;
    if (p.installationId != null) body.installation_id = p.installationId;
    if (p.customerId != null) body.customer_id = p.customerId;
    if (p.label != null) body.label = p.label;
    const state = await this.core.guardState();
    if (state.guard) guardPayload('identify', body);
    const { data } = await this.core.requester.request<PersonIdentified>({ method: 'POST', path: '/v1/people/identify', body, ...requestOptions });
    return data;
  }

  /**
   * The organisation's server SDK config (private mode, click-ID parameter, goals), cached for 10 minutes.
   * `null` when it can't be loaded.
   *
   * @example
   * const config = await clikgate.config();
   * if (config?.private_mode) console.log('private mode is on');
   */
  config(): Promise<ServerSdkConfig | null> {
    return this.core.configCache.get();
  }

  /**
   * Send everything queued (and wait for sends in flight). Resolves `true` when done within `timeout` ms.
   * Never rejects.
   *
   * @example
   * export async function handler(event) {
   *   clikgate.goal('order_paid', { reference: event.orderId, value: event.amount });
   *   await clikgate.flush();
   * }
   */
  flush(timeout = 10_000): Promise<boolean> {
    return this.queue.flush(timeout);
  }

  /**
   * Stop timers and shutdown hooks, then flush. Later `goal()` calls go to `onError` (`client_closed`).
   *
   * @example
   * process.on('SIGTERM', async () => { await clikgate.close(); server.close(); });
   */
  async close(timeout = 10_000): Promise<boolean> {
    if (!this.closed) {
      this.closed = true;
      this.queue.stop();
      if (this.shutdownEntry) unregisterShutdown(this.shutdownEntry);
    }
    return this.queue.flush(timeout);
  }
}
