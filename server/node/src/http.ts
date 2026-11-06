import { randomUUID } from 'node:crypto';
import { ClikgateError, NetworkError, RateLimitError, ServerError, TimeoutError, errorFromResponse, localError, retryAfterMs } from './errors.js';
import type { Transport, TransportResponse } from './transport.js';

/** Clock and sleep, replaceable for tests (SPEC section 18). */
export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** Wait `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

/** @internal The default clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/** Per-call options accepted by every API method. */
export interface RequestOptions {
  /** Override the `Idempotency-Key` (POST and PATCH only). */
  idempotencyKey?: string;
  /** Override the client's per-attempt timeout (ms). */
  timeout?: number;
  /** Override the client's `maxRetries` for this call. */
  maxRetries?: number;
}

/** @internal A request as the resources describe it. */
export interface ApiRequest extends RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Binary response (QR codes): return the raw bytes. */
  raw?: boolean;
}

/** @internal */
export interface RawResult {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 20_000;
const MAX_RETRY_AFTER_MS = 60_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** @internal Encode one path segment (RFC 3986 unreserved characters kept). */
export function encodePathSegment(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** @internal Format a Date (or pass a string through) as RFC 3339 UTC (SPEC section 4). */
export function formatDate(d: Date | string): string {
  if (typeof d === 'string') return d;
  const iso = d.toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** @internal Exported for tests. */
export function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const parts: string[] = [];
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    const s = v instanceof Date ? formatDate(v) : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`);
  };
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((item) => add(k, item));
    else if (isPlainObject(v)) {
      // A map (e.g. `metadata: { seller_id: 'sel_ada' }`) is sent as `metadata[seller_id]=sel_ada` (SPEC section 21).
      for (const [sub, sv] of Object.entries(v)) add(`${k}[${sub}]`, sv);
    } else add(k, v);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** @internal JSON body: drops `undefined`, keeps explicit `null`, formats Dates and bigints. */
export function toJson(body: unknown): string {
  return JSON.stringify(body, (_k, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    return v;
  });
}

/** @internal Settings the requester needs. */
export interface RequesterSettings {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
  transport: Transport;
  clock: Clock;
  random: () => number;
}

/** @internal The one HTTP pipeline every call (hand-written and generated) goes through. */
export class Requester {
  constructor(private readonly s: RequesterSettings) {}

  /** Full-jitter backoff for retry number `n` (0-based). */
  backoffMs(n: number): number {
    return Math.floor(this.s.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** n));
  }

  /** Send a JSON request and parse the JSON answer (`null` for an empty body). */
  async request<T>(req: ApiRequest): Promise<{ status: number; data: T; headers: Record<string, string> }> {
    const res = await this.send(req);
    const text = new TextDecoder().decode(res.body);
    const data = (text.trim() ? JSON.parse(text) : null) as T;
    return { status: res.status, data, headers: res.headers };
  }

  /** Send a request; resolves with the 2xx response or throws a typed error (after retries). */
  async send(req: ApiRequest): Promise<RawResult> {
    const url = `${this.s.baseUrl}${req.path}${queryString(req.query)}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.s.apiKey}`,
      'user-agent': this.s.userAgent,
      accept: 'application/json',
    };
    let body: Uint8Array | undefined;
    if (req.body !== undefined) {
      body = new TextEncoder().encode(toJson(req.body));
      headers['content-type'] = 'application/json';
    }
    if (req.method === 'POST' || req.method === 'PATCH') headers['idempotency-key'] = req.idempotencyKey ?? randomUUID();
    const maxRetries = req.maxRetries ?? this.s.maxRetries;
    const timeoutMs = req.timeout ?? this.s.timeoutMs;

    for (let attempt = 0; ; attempt++) {
      let error: ClikgateError;
      let res: TransportResponse;
      try {
        res = await this.s.transport({ method: req.method, url, headers, body, timeoutMs });
      } catch (err) {
        error = err instanceof ClikgateError ? err : new NetworkError({ message: 'Could not reach the Clikgate API.', code: 'network_error' });
        if (attempt >= maxRetries) throw error;
        await this.s.clock.sleep(this.backoffMs(attempt));
        continue;
      }
      if (res.status >= 200 && res.status < 300) return res;
      error = errorFromResponse(res.status, res.headers, res.body, this.s.clock.now());
      if (!RETRYABLE_STATUS.has(res.status)) throw error;
      let delay = this.backoffMs(attempt);
      if (res.status === 429 || res.status === 503) {
        const ra = retryAfterMs(res.headers, this.s.clock.now());
        if (ra !== null) {
          if (ra > MAX_RETRY_AFTER_MS) throw error;
          delay = ra;
        }
      }
      if (attempt >= maxRetries) throw error;
      await this.s.clock.sleep(delay);
    }
  }
}

/** @internal True when the error class is retryable at the batch level (SPEC 9.3). */
export function isRetryable(err: unknown): boolean {
  if (err instanceof NetworkError || err instanceof TimeoutError || err instanceof RateLimitError) return true;
  return err instanceof ServerError && err.httpStatus !== null && RETRYABLE_STATUS.has(err.httpStatus);
}

/** @internal Require a non-empty id argument. */
export function requireId(id: unknown, name = 'id'): string {
  if (typeof id !== 'string' || id.length === 0) throw localError('invalid_argument', `${name} must be a non-empty string.`, name);
  return id;
}
