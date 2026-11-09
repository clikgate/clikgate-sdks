/**
 * Typed errors (SPEC section 5). Every error extends {@link ClikgateError}.
 *
 * @example
 * import { Clikgate, RateLimitError, InvalidRequestError } from '@clikgate/node';
 * try {
 *   await clikgate.goals.send('account_opened', { reference: 'APP-55231', value: '2000000' });
 * } catch (err) {
 *   if (err instanceof RateLimitError) console.log('retry in', err.retryAfter, 's');
 *   else if (err instanceof InvalidRequestError) console.log(err.code, err.param);
 *   else throw err;
 * }
 */

/** Error codes with documented meaning (SPEC section 5). Other codes can appear; `code` is a plain string. */
export type KnownErrorCode =
  | 'invalid_goal_key'
  | 'invalid_reference'
  | 'invalid_value'
  | 'click_id_and_code'
  | 'batch_too_large'
  | 'batch_empty'
  | 'invalid_argument'
  | 'invalid_click_id'
  | 'queue_full'
  | 'client_closed'
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'invalid_option'
  | 'network_error'
  | 'timeout'
  | 'unexpected_status'
  | 'rate_limit_exceeded'
  | 'private_mode_field_rejected'
  | 'link_locked'
  | 'idempotency_key_reused'
  | 'idempotency_request_in_progress'
  | 'goal_archived'
  | 'goal_not_found'
  | 'value_required'
  | 'value_not_allowed'
  | 'domain_mode_mismatch'
  | 'https_required'
  | 'destination_not_allowlisted'
  | 'test_destination_not_allowed'
  | 'test_link_limit_reached'
  | 'plan_limit_reached'
  | 'plan_upgrade_required'
  | 'plan_feature_unavailable'
  | 'feature_disabled'
  | 'invalid_provider'
  | 'unknown_provider'
  | 'code_not_supported'
  | 'payment_goal_needs_confirmation'
  | 'unknown_goal'
  | 'cli_scope'
  | 'missing_signature'
  | 'malformed_signature'
  | 'timestamp_outside_tolerance'
  | 'no_matching_signature'
  | 'invalid_payload'
  | 'server_only'
  | 'invalid_customer_id'
  | 'missing_identity_secret'
  | 'invalid_identity_secrets';

/** Fields every Clikgate error carries. */
export interface ClikgateErrorInit {
  message: string;
  code: string;
  httpStatus?: number | null;
  requestId?: string | null;
  param?: string | null;
  type?: string | null;
  raw?: unknown;
}

/** Base class of every error the SDK throws. */
export class ClikgateError extends Error {
  /** Stable machine-readable code, e.g. `invalid_value`, `link_locked`, `network_error`. */
  readonly code: string;
  /** HTTP status, or `null` for local, network and timeout errors. */
  readonly httpStatus: number | null;
  /** The request ID (`req_…`) to quote to Clikgate support, when the API answered. */
  readonly requestId: string | null;
  /** The request field the error is about, when there is one. */
  readonly param: string | null;
  /** The envelope `type` (`invalid_request`, `conflict`, …), or `null` for local errors. */
  readonly type: string | null;
  /** The raw `error` object from the API, including extra keys such as `required_plan`. */
  readonly raw: unknown;

  constructor(init: ClikgateErrorInit) {
    super(init.message);
    this.name = new.target.name;
    this.code = init.code;
    this.httpStatus = init.httpStatus ?? null;
    this.requestId = init.requestId ?? null;
    this.param = init.param ?? null;
    this.type = init.type ?? null;
    this.raw = init.raw ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid client options. Thrown by the constructor, never later. */
export class ConfigurationError extends ClikgateError {}
/** 401: the API key is missing, invalid, expired or revoked. */
export class AuthenticationError extends ClikgateError {}
const rawField = (raw: unknown, key: string): unknown => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[key] : undefined);

/**
 * 403: missing scope, role, feature or plan (`insufficient_scope`, `plan_limit_reached`, `plan_upgrade_required`,
 * `feature_disabled`, `test_link_limit_reached`, `cli_scope`, …).
 */
export class PermissionError extends ClikgateError {
  /** On `plan_limit_reached` / `plan_upgrade_required`: the lowest plan that allows it. */
  get requiredPlan(): string | null {
    const v = rawField(this.raw, 'required_plan');
    return typeof v === 'string' ? v : null;
  }
  /** On `test_link_limit_reached`: the number of active test links allowed. */
  get limit(): number | null {
    const v = rawField(this.raw, 'limit');
    return typeof v === 'number' ? v : null;
  }
}
/** 400, 410, 422 and other 4xx (`invalid_value`, `domain_mode_mismatch`, `test_destination_not_allowed`, …); also local validation (`httpStatus` null). */
export class InvalidRequestError extends ClikgateError {
  /** For batch calls: the index of the event that failed local validation. */
  index: number | null = null;
  /** On `test_destination_not_allowed`: the allowed destination kinds. */
  get allowed(): string[] | null {
    const v = rawField(this.raw, 'allowed');
    return Array.isArray(v) ? v.map(String) : null;
  }
  /** On `test_destination_not_allowed`: the docs page explaining test-link destinations. */
  get docUrl(): string | null {
    const v = rawField(this.raw, 'doc_url');
    return typeof v === 'string' ? v : null;
  }
}
/** Private mode refused a field (locally, before sending, or by the API). Carries the field **name** only. */
export class PrivateModeFieldRejectedError extends InvalidRequestError {
  /** The refused field name, e.g. `metadata`. Never its value. */
  readonly field: string;
  constructor(init: ClikgateErrorInit & { field: string }) {
    super(init);
    this.field = init.field;
  }
}
/** 404. */
export class NotFoundError extends ClikgateError {}
/** 409. */
export class ConflictError extends ClikgateError {}
/** 409 `link_locked`: the link is locked; destination, fallback and deep-link changes are refused. */
export class LinkLockedError extends ConflictError {}
/** 409 `idempotency_*`: the key was used with a different request, or the first request is still running. */
export class IdempotencyError extends ClikgateError {}
/** 429. */
export class RateLimitError extends ClikgateError {
  /** Seconds from `Retry-After`, or `null`. */
  readonly retryAfter: number | null;
  constructor(init: ClikgateErrorInit & { retryAfter?: number | null }) {
    super(init);
    this.retryAfter = init.retryAfter ?? null;
  }
}
/** 5xx, or an unexpected status (redirects are never followed). */
export class ServerError extends ClikgateError {
  /** Seconds from `Retry-After` on a 503, or `null`. */
  readonly retryAfter: number | null;
  constructor(init: ClikgateErrorInit & { retryAfter?: number | null }) {
    super(init);
    this.retryAfter = init.retryAfter ?? null;
  }
}
/** The connection failed (DNS, refused, reset, TLS). */
export class NetworkError extends ClikgateError {}
/** The per-attempt timeout elapsed. */
export class TimeoutError extends ClikgateError {}
/** A webhook signature didn't verify. `code`: `missing_signature`, `malformed_signature`, `timestamp_outside_tolerance`, `no_matching_signature` or `invalid_payload`. */
export class SignatureVerificationError extends ClikgateError {}
/**
 * `createIdentityToken()` ran in a browser or a React Native app. Identity tokens are signed with
 * your identity secret, which must stay on your server. `code`: `server_only`.
 */
export class ClikgateServerOnlyError extends ClikgateError {}

const SNIPPET = 200;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const stripControl = (t: string) => t.replace(CONTROL, ' ');

function retryAfterSeconds(headers: Record<string, string>, nowMs: number): number | null {
  const v = headers['retry-after'];
  if (v === undefined) return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - nowMs) / 1000));
}

/** @internal Parse `Retry-After` in milliseconds, or null when absent or unparseable. */
export function retryAfterMs(headers: Record<string, string>, nowMs: number): number | null {
  const v = headers['retry-after'];
  if (v === undefined) return null;
  const s = v.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.max(0, t - nowMs);
}

interface Envelope {
  type?: unknown;
  code?: unknown;
  message?: unknown;
  param?: unknown;
  request_id?: unknown;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** @internal Map an HTTP response to a typed error (SPEC 5, rules 3-13). */
export function errorFromResponse(status: number, headers: Record<string, string>, body: Uint8Array, nowMs: number): ClikgateError {
  const text = new TextDecoder().decode(body);
  let envelope: Envelope | null = null;
  let refusal: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const e = (parsed as { error: unknown }).error;
      if (e && typeof e === 'object') envelope = e as Envelope;
    } else if (isRefusalBody(parsed)) {
      refusal = parsed;
    }
  } catch {
    envelope = null;
  }
  const requestId = str(envelope?.request_id) ?? headers['x-request-id'] ?? null;
  const code = str(envelope?.code) ?? str(refusal?.reason) ?? (status >= 300 && status < 400 ? 'unexpected_status' : `http_${status}`);
  const message = str(envelope?.message) ?? `HTTP ${status}${text ? `: ${stripControl(text.slice(0, SNIPPET))}` : ''}`;
  const init: ClikgateErrorInit = {
    message,
    code: status >= 300 && status < 400 ? 'unexpected_status' : code,
    httpStatus: status,
    requestId,
    param: str(envelope?.param),
    type: str(envelope?.type),
    raw: envelope ?? refusal,
  };
  const retryAfter = retryAfterSeconds(headers, nowMs);
  if (status === 429) return new RateLimitError({ ...init, code: str(envelope?.code) ?? 'rate_limit_exceeded', retryAfter });
  if (status >= 500) return new ServerError({ ...init, retryAfter });
  if (init.code === 'private_mode_field_rejected') return new PrivateModeFieldRejectedError({ ...init, field: init.param ?? 'unknown' });
  if (status === 401) return new AuthenticationError(init);
  if (status === 403) return new PermissionError(init);
  if (status === 404) return new NotFoundError(init);
  if (status === 409 && (init.type === 'idempotency' || init.code.startsWith('idempotency_'))) return new IdempotencyError(init);
  if (status === 409 && init.code === 'link_locked') return new LinkLockedError(init);
  if (status === 409) return new ConflictError(init);
  if (status >= 400) return new InvalidRequestError(init);
  return new ServerError({ ...init, retryAfter: null });
}

/**
 * A goal refusal answered as a result body instead of an error envelope (`422 {status: "refused", reason:
 * "unknown_goal", ...}`): the reason is the error code.
 */
function isRefusalBody(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return o.status === 'refused' && typeof o.reason === 'string' && o.reason !== '';
}

/** @internal Map a batch item's `{status, error}` to a typed error. */
export function errorFromBatchItem(status: number, error: unknown): ClikgateError {
  const body = new TextEncoder().encode(JSON.stringify({ error: error ?? {} }));
  return errorFromResponse(status, {}, body, Date.now());
}

/** @internal A local validation error (no HTTP request was made). */
export function localError(code: string, message: string, param: string | null = null): InvalidRequestError {
  return new InvalidRequestError({ message, code, param, httpStatus: null });
}
