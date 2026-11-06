import type { IncomingMessage, ServerResponse } from 'node:http';
import { localError } from './errors.js';

/** The click ID format: a prefixed ULID, `clk_` + 26 uppercase Crockford characters. */
export const CLICK_ID_PATTERN = /^clk_[0-9A-Z]{26}$/;
/** The header a caller (e.g. your mobile app or BFF) can use to pass the click ID. */
export const CLICK_ID_HEADER = 'clikgate-click-id';
const DEFAULT_PARAM = 'cgid';
const PAYMENT_KEYS = ['cg_click_id', 'cgid', 'clikgate_click_id'] as const;
const CONTAINERS = ['metadata', 'meta', 'meta_data', 'note_attributes', 'attributes', 'custom_attributes', 'customAttributes'] as const;

/**
 * Anything request-like: Node/Express/Connect/Fastify requests, Fetch `Request`, Next.js `NextRequest`,
 * or a plain `{ url, headers }` object.
 */
export type RequestLike =
  | { url?: string; originalUrl?: string; headers?: unknown; nextUrl?: { href: string } }
  | { url: string; headers: { get(name: string): string | null } };

/** Anything response-like that can carry `Set-Cookie`: Node `ServerResponse`/Express `res`, Fastify `reply`, Fetch `Response`/`Headers`. */
export type ResponseLike = object;

/** Options for the click-ID cookie. */
export interface PersistOptions {
  /** Lifetime in days (default 30). */
  days?: number;
  /** Add `Secure`. Default: true when the request was HTTPS (or unknown). */
  secure?: boolean;
  /** Cookie domain, e.g. `.example.com` to share across subdomains. */
  domain?: string;
}

function header(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null;
  const h = headers as { get?: unknown } & Record<string, unknown>;
  if (typeof h.get === 'function') {
    const v = (h.get as (n: string) => unknown).call(headers, name);
    return typeof v === 'string' ? v : null;
  }
  for (const [k, v] of Object.entries(h)) {
    if (k.toLowerCase() !== name) continue;
    if (Array.isArray(v)) return v.join(name === 'cookie' ? '; ' : ', ');
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function requestUrl(req: RequestLike): URL | null {
  const r = req as { url?: unknown; originalUrl?: unknown; nextUrl?: { href?: unknown } };
  const raw = typeof r.nextUrl?.href === 'string' ? r.nextUrl.href : typeof r.originalUrl === 'string' ? r.originalUrl : typeof r.url === 'string' ? r.url : null;
  if (raw === null) return null;
  try {
    return new URL(raw, 'http://localhost');
  } catch {
    return null;
  }
}

function cookieValue(cookieHeader: string | null, name: string): string[] {
  if (!cookieHeader) return [];
  const out: string[] = [];
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      out.push(decodeURIComponent(v));
    } catch {
      out.push(v);
    }
  }
  return out;
}

function parseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function asMap(container: unknown): Record<string, unknown> | null {
  let c = container;
  if (typeof c === 'string') c = parseJson(c);
  if (Array.isArray(c)) {
    const m: Record<string, unknown> = {};
    for (const item of c) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      const k = i.name ?? i.key ?? i.variable_name ?? i.display_name;
      if (typeof k === 'string') m[k] = i.value;
    }
    return m;
  }
  return c && typeof c === 'object' ? (c as Record<string, unknown>) : null;
}

function pick(map: Record<string, unknown> | null, depth = 0): string | null {
  if (!map) return null;
  for (const k of PAYMENT_KEYS) {
    const v = map[k];
    if (isValid(v)) return v;
  }
  if (depth === 0 && Array.isArray(map.custom_fields)) return pick(asMap(map.custom_fields), 1);
  return null;
}

/**
 * True when `id` is a Clikgate click ID (`clk_` + 26 characters).
 *
 * @example
 * clickIds.isValid('clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6'); // true
 */
export function isValid(id: unknown): id is string {
  return typeof id === 'string' && CLICK_ID_PATTERN.test(id);
}

/** Click-ID helpers bound to a `click_id_param` (SPEC section 13). */
export class ClickIds {
  /** @internal */
  constructor(private readonly param: () => string) {}

  /** The query parameter name in use (`cgid` unless configured). */
  get paramName(): string {
    return this.param();
  }

  /** The cookie name: `_cg_<param>`, the same first-party cookie the web script writes. */
  get cookieName(): string {
    return `_cg_${this.param()}`;
  }

  /** {@inheritDoc isValid} */
  isValid(id: unknown): id is string {
    return isValid(id);
  }

  /**
   * Read the click ID from a request: the query parameter, then the `_cg_<param>` cookie, then the
   * `Clikgate-Click-Id` header. Only valid IDs are returned.
   *
   * @example
   * app.post('/signup', (req, res) => {
   *   const clickId = clikgate.clickIds.fromRequest(req);  // save it with the application
   * });
   */
  fromRequest(req: RequestLike): string | null {
    return this.locate(req)?.id ?? null;
  }

  /** The click ID and where it was found (query, cookie or header). */
  private locate(req: RequestLike): { id: string; from: 'query' | 'cookie' | 'header' } | null {
    if (!req || typeof req !== 'object') return null;
    const url = requestUrl(req);
    if (url) {
      for (const v of url.searchParams.getAll(this.param())) if (isValid(v)) return { id: v, from: 'query' };
    }
    const headers = (req as { headers?: unknown }).headers;
    for (const v of cookieValue(header(headers, 'cookie'), this.cookieName)) if (isValid(v)) return { id: v, from: 'cookie' };
    const h = header(headers, CLICK_ID_HEADER)?.trim();
    return isValid(h) ? { id: h, from: 'header' } : null;
  }

  /**
   * The visitor context to send with a goal (SPEC 13.1): the click ID, how it was kept, and the browser engine and
   * platform parsed from the `User-Agent` here in the SDK (the User-Agent itself is never sent). Spread it into the
   * goal options.
   *
   * - `keptBy` is `server_cookie` when the ID came from the cookie and the `_cg_kept=s` marker is there (your server
   *   set it, see {@link keepRoute} and {@link persist}), `script_cookie` for the cookie without the marker, `form`
   *   for the `Clikgate-Click-Id` header, and `null` when it came from the URL or there is none.
   *
   * @example
   * app.post('/signup', (req, res) => {
   *   clikgate.goal('account_opened', { reference: application.id, ...clikgate.clickIds.context(req) });
   * });
   */
  context(req: RequestLike): ClickContext {
    const found = this.locate(req);
    const headers = req && typeof req === 'object' ? (req as { headers?: unknown }).headers : undefined;
    let keptBy: KeptBy | null = null;
    if (found?.from === 'cookie') keptBy = cookieValue(header(headers, 'cookie'), KEPT_COOKIE).includes(KEPT_VALUE) ? 'server_cookie' : 'script_cookie';
    else if (found?.from === 'header') keptBy = 'form';
    const ua = header(headers, 'user-agent') ?? '';
    return { clickId: found?.id ?? null, keptBy, browserEngine: browserEngineOf(ua), platform: platformOf(ua) };
  }

  /**
   * The `Set-Cookie` value that keeps the click ID: `SameSite=Lax`, `Secure` on HTTPS, not `HttpOnly`
   * (the web script reads it).
   *
   * @example
   * clikgate.clickIds.cookieHeader(clickId, { days: 30 });
   * // '_cg_cgid=clk_…; Path=/; Max-Age=2592000; SameSite=Lax; Secure'
   */
  cookieHeader(id: string, options: PersistOptions = {}): string {
    if (!isValid(id)) throw localError('invalid_click_id', 'That is not a Clikgate click ID (clk_ + 26 characters).', 'click_id');
    const days = options.days ?? 30;
    const parts = [`${this.cookieName}=${id}`, 'Path=/', `Max-Age=${Math.round(days * 86400)}`];
    if (options.domain) parts.push(`Domain=${options.domain}`);
    parts.push('SameSite=Lax');
    if (options.secure ?? true) parts.push('Secure');
    return parts.join('; ');
  }

  /**
   * Add the click-ID cookie to a response, keeping any `Set-Cookie` headers already there.
   *
   * @example
   * const clickId = clikgate.clickIds.fromRequest(req);
   * if (clickId) clikgate.clickIds.persist(res, clickId);
   */
  persist(res: ResponseLike, id: string, options: PersistOptions = {}): void {
    const secure = options.secure ?? inferSecure(res);
    appendSetCookie(res, this.cookieHeader(id, { ...options, secure }));
    appendSetCookie(res, keptMarkerHeader({ ...options, secure }));
  }

  /**
   * The `/cg/keep` handler (SPEC 13.1): the web script's `data-server-endpoint="/cg/keep"` posts the click ID from the
   * page URL here, and your server sets the `_cg_<param>` cookie (plus the `_cg_kept=s` marker) for `days` days.
   * Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less); a cookie
   * your server sets lasts as long as you choose, up to the browser's limit. Serve it from the same host as your website.
   *
   * Returns a Fetch handler (`(Request) => Promise<Response>`, e.g. a Next.js App Router `POST`), with
   * `.express` (Express/Connect) and `.node` (`node:http`) adapters, and `.handle` for any other framework.
   * Only same-origin `POST`s with a valid, matching click ID are accepted; every answer is `no-store` with an
   * empty body. `secure` defaults to true here.
   *
   * @throws InvalidRequestError `invalid_argument` when `days` is not 1-400.
   * @example
   * // app/cg/keep/route.ts
   * export const POST = clikgate.clickIds.keepRoute();
   * // Express
   * app.all('/cg/keep', clikgate.clickIds.keepRoute({ days: 90 }).express);
   */
  keepRoute(options: KeepRouteOptions = {}): KeepRoute {
    const days = options.days ?? 30;
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 1 || days > 400) {
      throw localError('invalid_argument', 'days must be between 1 and 400 (browsers keep a cookie for at most 400 days).', 'days');
    }
    const cookie: PersistOptions = { days, secure: options.secure ?? true, domain: options.domain };
    const handle = (input: KeepInput): Promise<KeepResult> => keepCore(input, (id, o) => this.cookieHeader(id, o), cookie);
    const route = (async (request: Request): Promise<Response> => {
      const out = await handle({ method: request.method, headers: request.headers, readBody: () => readFetchBody(request), url: request.url });
      return new Response(null, { status: out.status, headers: out.headers });
    }) as KeepRoute;
    route.handle = handle;
    route.node = (req, res) => {
      void handle({ method: req.method ?? '', headers: req.headers, readBody: () => readNodeBody(req) }).then((out) => writeNode(req, res, out));
    };
    route.express = (req, res, next) => {
      handle({ method: req.method ?? '', headers: req.headers, readBody: () => readNodeBody(req) }).then(
        (out) => writeNode(req, res, out),
        (err: unknown) => (next ? next(err) : writeNode(req, res, { status: 400, headers: [...NO_STORE] })),
      );
    };
    return route;
  }

  /**
   * Find the click ID in a payment provider's payload: Paystack `metadata` (and `custom_fields`),
   * Flutterwave `meta`, Shopify note or cart attributes, WooCommerce order meta, or your own webhook.
   *
   * @example
   * app.post('/paystack/webhook', express.json(), (req, res) => {
   *   const clickId = clikgate.clickIds.fromPaymentMetadata(req.body);
   * });
   */
  fromPaymentMetadata(payload: unknown): string | null {
    let p = payload;
    if (typeof p === 'string') p = parseJson(p);
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    const root = p as Record<string, unknown>;
    const candidates = [root];
    if (root.data && typeof root.data === 'object' && !Array.isArray(root.data)) candidates.push(root.data as Record<string, unknown>);
    for (const c of candidates) {
      const own = pick(c);
      if (own) return own;
      for (const name of CONTAINERS) {
        if (c[name] === undefined) continue;
        const found = pick(asMap(c[name]));
        if (found) return found;
      }
    }
    return null;
  }
}

/** How the click ID was kept (`kept_by`, SPEC 9.1). */
export type KeptBy = 'server_cookie' | 'script_cookie' | 'form' | 'payment_metadata' | 'unknown';
/** The browser engine family (`browser_engine`, SPEC 9.1). */
export type BrowserEngine = 'webkit_ios' | 'safari_mac' | 'chromium' | 'gecko' | 'other';
/** The visitor's platform (`platform`, SPEC 9.1). */
export type Platform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other';
/** Every `kept_by` value. */
export const KEPT_BY: readonly KeptBy[] = ['server_cookie', 'script_cookie', 'form', 'payment_metadata', 'unknown'];
/** Every `browser_engine` value. */
export const BROWSER_ENGINES: readonly BrowserEngine[] = ['webkit_ios', 'safari_mac', 'chromium', 'gecko', 'other'];
/** Every `platform` value. */
export const PLATFORMS: readonly Platform[] = ['ios', 'android', 'macos', 'windows', 'linux', 'other'];

/** What `clickIds.context(req)` returns; its keys are goal options, so spread it into a goal. */
export interface ClickContext {
  clickId: string | null;
  keptBy: KeptBy | null;
  browserEngine: BrowserEngine;
  platform: Platform;
}

/** Options for `clickIds.keepRoute()`. */
export interface KeepRouteOptions {
  /** Cookie lifetime in days, 1-400 (default 30). */
  days?: number;
  /** Add `Secure` (default true). */
  secure?: boolean;
  /** Cookie domain, e.g. `.example.com` to share across subdomains. */
  domain?: string;
}

/** A framework-neutral `/cg/keep` request. `readBody` returns the raw body, or `null` when it is over 1024 bytes. */
export interface KeepInput {
  method: string;
  /** Header names in any case: a plain object, a Node `IncomingHttpHeaders` or a Fetch `Headers`. */
  headers: unknown;
  readBody: () => Promise<Uint8Array | null>;
  /** The request URL, used for the host only when there is no `Host` header. Its query string is never read. */
  url?: string;
}

/** A `/cg/keep` answer: the status and the headers to send (the body is always empty). */
export interface KeepResult {
  status: 204 | 400 | 403 | 405;
  headers: Array<[string, string]>;
}

type NodeReq = IncomingMessage & { body?: unknown };
type NodeRes = ServerResponse;

/** The `/cg/keep` route: a Fetch handler plus framework adapters. */
export interface KeepRoute {
  (request: Request): Promise<Response>;
  /** Express / Connect: `app.all('/cg/keep', route.express)` (mount it before a body parser, or after one, both work). */
  express: (req: NodeReq, res: NodeRes, next?: (err?: unknown) => void) => void;
  /** Plain `node:http`: `if (req.url === '/cg/keep') return route.node(req, res)`. */
  node: (req: NodeReq, res: NodeRes) => void;
  /** The framework-neutral core, for any other framework. */
  handle: (input: KeepInput) => Promise<KeepResult>;
}

/** The marker cookie that tells the web script (and `context()`) that your server kept the click ID. */
export const KEPT_COOKIE = '_cg_kept';
const KEPT_VALUE = 's';
const KEEP_MAX_BODY = 1024;
const NO_STORE: ReadonlyArray<[string, string]> = [['Cache-Control', 'no-store, private']];

/** @internal `_cg_kept=s` with the click-ID cookie's attributes. */
export function keptMarkerHeader(options: PersistOptions): string {
  const parts = [`${KEPT_COOKIE}=${KEPT_VALUE}`, 'Path=/', `Max-Age=${Math.round((options.days ?? 30) * 86400)}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  parts.push('SameSite=Lax');
  if (options.secure ?? true) parts.push('Secure');
  return parts.join('; ');
}

/** @internal The `browser_engine` for a User-Agent (SPEC 13.1 table, checked in order). */
export function browserEngineOf(ua: string): BrowserEngine {
  if (/iPhone|iPad|iPod/.test(ua)) return 'webkit_ios';
  if (ua.includes('Firefox/')) return 'gecko';
  if (/Chrome\/|Chromium\/|Edg\/|OPR\/|SamsungBrowser\//.test(ua)) return 'chromium';
  if (ua.includes('Macintosh') && ua.includes('Safari/') && ua.includes('Version/')) return 'safari_mac';
  return 'other';
}

/** @internal The `platform` for a User-Agent (SPEC 13.1 table, checked in order). */
export function platformOf(ua: string): Platform {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (ua.includes('Android')) return 'android';
  if (ua.includes('Macintosh') || ua.includes('Mac OS X')) return 'macos';
  if (ua.includes('Windows')) return 'windows';
  if (ua.includes('Linux') || ua.includes('X11')) return 'linux';
  return 'other';
}

function expectedHost(input: KeepInput): string | null {
  const forwarded = header(input.headers, 'x-forwarded-host')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  const host = header(input.headers, 'host')?.trim();
  if (host) return host;
  if (!input.url) return null;
  try {
    return new URL(input.url).host || null;
  } catch {
    return null;
  }
}

function sameOrigin(input: KeepInput): boolean {
  const site = header(input.headers, 'sec-fetch-site');
  if (site !== null) return site.trim().toLowerCase() === 'same-origin';
  const origin = header(input.headers, 'origin')?.trim().toLowerCase();
  const host = expectedHost(input)?.toLowerCase();
  if (!origin || !host) return false;
  return origin === `https://${host}` || origin === `http://${host}`;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** @internal The one `/cg/keep` implementation every adapter calls (SPEC 13.1). Never logs or echoes the input. */
async function keepCore(input: KeepInput, cookieHeader: (id: string, o: PersistOptions) => string, cookie: PersistOptions): Promise<KeepResult> {
  const refuse = (status: 400 | 403 | 405): KeepResult => ({ status, headers: status === 405 ? [...NO_STORE, ['Allow', 'POST']] : [...NO_STORE] });
  if (String(input.method).toUpperCase() !== 'POST') return refuse(405);
  if (!sameOrigin(input)) return refuse(403);
  let bytes: Uint8Array | null;
  try {
    bytes = await input.readBody();
  } catch {
    return refuse(400);
  }
  if (!bytes || bytes.byteLength > KEEP_MAX_BODY) return refuse(400);
  let body: unknown;
  try {
    body = JSON.parse(utf8.decode(bytes));
  } catch {
    return refuse(400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400);
  const { click_id: id, page_click_id: pageId } = body as Record<string, unknown>;
  if (!isValid(id) || !isValid(pageId) || id !== pageId) return refuse(400);
  return {
    status: 204,
    headers: [...NO_STORE, ['Set-Cookie', cookieHeader(id, cookie)], ['Set-Cookie', keptMarkerHeader(cookie)]],
  };
}

async function readFetchBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > KEEP_MAX_BODY) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return concat(chunks, size);
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

function readNodeBody(req: NodeReq): Promise<Uint8Array | null> {
  // already read by a body parser (express.json(), express.text(), express.raw(), …)
  if (req.readableEnded || req.body !== undefined) {
    const b = req.body;
    if (b instanceof Uint8Array) return Promise.resolve(b);
    if (typeof b === 'string') return Promise.resolve(new TextEncoder().encode(b));
    if (b && typeof b === 'object') return Promise.resolve(new TextEncoder().encode(JSON.stringify(b)));
    return Promise.resolve(new Uint8Array(0));
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
    };
    const onData = (chunk: Buffer | string) => {
      const c = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      size += c.byteLength;
      if (size > KEEP_MAX_BODY) {
        cleanup();
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(c);
    };
    const onEnd = () => {
      cleanup();
      resolve(concat(chunks, size));
    };
    const onError = (err: unknown) => {
      cleanup();
      reject(err);
    };
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function writeNode(req: NodeReq, res: NodeRes, out: KeepResult): void {
  if (res.headersSent) return;
  res.statusCode = out.status;
  for (const [name, value] of out.headers) {
    if (name === 'Set-Cookie') appendSetCookie(res, value);
    else res.setHeader(name, value);
  }
  if (!req.readableEnded && req.isPaused()) {
    // a body over 1 KB was left unread: close the connection after answering
    res.setHeader('Connection', 'close');
    res.once('finish', () => req.destroy());
  }
  res.end();
}

function inferSecure(res: ResponseLike): boolean {
  const r = res as { req?: { socket?: { encrypted?: boolean }; headers?: unknown }; request?: { protocol?: string } };
  if (r.request && typeof r.request.protocol === 'string') return r.request.protocol === 'https';
  const req = r.req;
  if (!req) return true;
  const proto = header(req.headers, 'x-forwarded-proto');
  if (proto) return proto.split(',')[0]!.trim().toLowerCase() === 'https';
  if (req.socket) return !!req.socket.encrypted;
  return true;
}

/** @internal Append a Set-Cookie header to any supported response type. */
export function appendSetCookie(res: ResponseLike, value: string): void {
  const r = res as Record<string, unknown> & { headers?: { append?: unknown } };
  // Fastify reply: header() appends for set-cookie
  if (typeof r.header === 'function' && 'raw' in r) {
    (r.header as (n: string, v: string) => unknown).call(res, 'set-cookie', value);
    return;
  }
  // Node >= 18.3 ServerResponse (Express, Connect)
  if (typeof r.appendHeader === 'function') {
    (r.appendHeader as (n: string, v: string) => unknown).call(res, 'Set-Cookie', value);
    return;
  }
  if (typeof r.getHeader === 'function' && typeof r.setHeader === 'function') {
    const existing = (r.getHeader as (n: string) => unknown).call(res, 'Set-Cookie');
    const list = existing === undefined ? [] : Array.isArray(existing) ? existing.map(String) : [String(existing)];
    (r.setHeader as (n: string, v: string[]) => unknown).call(res, 'Set-Cookie', [...list, value]);
    return;
  }
  // Fetch Response / NextResponse
  if (r.headers && typeof r.headers.append === 'function') {
    (r.headers.append as (n: string, v: string) => unknown).call(r.headers, 'set-cookie', value);
    return;
  }
  // a Headers object itself
  if (typeof r.append === 'function') {
    (r.append as (n: string, v: string) => unknown).call(res, 'set-cookie', value);
    return;
  }
  throw localError('invalid_argument', 'persist() needs a response with setHeader/appendHeader or Fetch headers.', 'response');
}

/** Click-ID helpers with the default parameter (`cgid`), usable without a client. */
export const clickIds = new ClickIds(() => DEFAULT_PARAM);
