import { isValid as isValidClickId } from './click-ids.js';
import { Provider } from './enums.js';
import type { Core } from './core.js';
import { ClikgateError, localError } from './errors.js';
import { guardPayload } from './guard.js';
import { formatDate, type RequestOptions } from './http.js';
import { formatValue, type MoneyInput } from './money.js';

/** Normalised payment statuses. */
export type PaymentStatus = 'success' | 'partial' | 'pending' | 'failed' | 'refunded' | 'reversed';

/** Parameters of `payments.confirm` (SPEC 22.2): the result of your own server's verification with the gateway. */
export interface PaymentConfirmParams {
  /**
   * The payment provider, e.g. `Provider.Paystack` (every gateway in `GET /v1/payment-gateways`). A provider key
   * string works too, for a gateway added after this SDK release; the API checks it.
   */
  provider: Provider | (string & {});
  /** The gateway's canonical payment reference, 1-128 characters. */
  reference: string;
  /** The gateway's verified status, normalised. */
  status: PaymentStatus;
  /** Amount in normal units (`'7500.00'` is ₦7,500). Prefer a decimal string. Not together with `amountMinor`. */
  amount?: MoneyInput | null;
  /** Amount in ISO 4217 minor units, instead of `amount`. */
  amountMinor?: number | bigint | null;
  /** ISO 4217 code (`NGN`, `usd`). */
  currency?: string | null;
  /** When the payment happened (default: now, on the server). */
  occurredAt?: Date | string | null;
  /** Up to 5 other references of the same payment (Stripe `cs_...`, Flutterwave transaction id). */
  aliases?: string[] | null;
  /** The click ID you stored in the gateway metadata (`cg_click_id`), used when no report arrives. */
  clickId?: string | null;
  /** A payment goal key (else the report's goal, else your default payment goal). */
  goal?: string | null;
  /** `true` for a gateway test payment; must match the API key's mode. */
  test?: boolean | null;
  /** Additional wire fields, merged last (forward compatibility). Refused in private mode. */
  extra?: Record<string, unknown>;
}

/** Options of the gateway helpers. */
export interface PaymentHelperOptions {
  /** A payment goal key. */
  goal?: string | null;
  /** A click ID you have yourself; wins over the `cg_click_id` in the gateway metadata. */
  clickId?: string | null;
}

/** The wire body of `POST /v1/payments/confirmations`, as the builders return it. */
export interface PaymentConfirmationBody {
  provider: Provider | (string & {});
  reference: string;
  status: PaymentStatus;
  aliases?: string[];
  amount?: string;
  amount_minor?: number | bigint;
  currency?: string;
  occurred_at?: string;
  test?: boolean;
  click_id?: string;
  goal?: string;
  [key: string]: unknown;
}

/** The `payment_confirmation` object. */
export interface PaymentConfirmation {
  object: 'payment_confirmation';
  id: string;
  /** A `Provider` value (or a newer gateway's key). */
  provider: Provider | (string & {});
  reference: string;
  status: PaymentStatus;
  amount: string | null;
  amount_minor: number | null;
  currency: string | null;
  occurred_at: string;
  route: string;
  match_status: string;
  report_id: string | null;
  goal_event_id: string | null;
  test: boolean;
  duplicate: boolean | null;
  [key: string]: unknown;
}

const PROVIDER = /^[a-z][a-z0-9_]{1,29}$/;
const GOAL_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const CURRENCY = /^[A-Za-z]{3}$/;
const STATUSES = new Set<string>(['success', 'partial', 'pending', 'failed', 'refunded', 'reversed']);
const STRIPE_ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);

const PAYSTACK_STATUS: Record<string, PaymentStatus> = {
  success: 'success',
  failed: 'failed',
  abandoned: 'failed',
  reversed: 'reversed',
  ongoing: 'pending',
  pending: 'pending',
  processing: 'pending',
  queued: 'pending',
};
const MONNIFY_STATUS: Record<string, PaymentStatus> = {
  PAID: 'success',
  OVERPAID: 'success',
  PARTIALLY_PAID: 'partial',
  FAILED: 'failed',
  CANCELLED: 'failed',
  ABANDONED: 'failed',
  EXPIRED: 'failed',
  PENDING: 'pending',
  REVERSED: 'reversed',
};

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An object, or JSON text of one; else null. */
function asObj(v: unknown): Obj | null {
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return isObj(v) ? v : null;
}

function unwrap(root: Obj, key: string): Obj {
  const inner = root[key];
  return isObj(inner) ? inner : root;
}

/** A trimmed string; numbers as their digits; empty or anything else is null. */
function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number' && Number.isFinite(v)) return Number.isInteger(v) ? BigInt(v).toString() : String(v);
  return null;
}

function first(...vs: unknown[]): unknown {
  for (const v of vs) if (v !== undefined && v !== null && v !== '') return v;
  return undefined;
}

// ---- exact decimals: digits × 10^-scale, never floating-point arithmetic -------------------------

interface Dec {
  digits: string;
  scale: number;
}

const DEC_TEXT = /^([+-]?)(\d+\.?\d*|\.\d+)(?:[eE]([+-]?\d+))?$/;

/** Parse an amount (integer, decimal string, float via its shortest round-trip text). Null when absent, unparsable or negative. */
function parseDec(v: unknown): Dec | null {
  let text: string;
  if (typeof v === 'string') text = v.trim();
  else if (typeof v === 'bigint') text = v.toString();
  else if (typeof v === 'number' && Number.isFinite(v)) text = String(v);
  else return null;
  const m = DEC_TEXT.exec(text);
  if (!m) return null;
  const [int = '', frac = ''] = (m[2] as string).split('.');
  let digits = `${int}${frac}`.replace(/^0+/, '');
  let scale = frac.length - Number(m[3] ?? 0);
  if (digits === '') return { digits: '0', scale: 0 };
  if (m[1] === '-') return null;
  if (scale < 0) {
    digits += '0'.repeat(-scale);
    scale = 0;
  }
  return { digits, scale };
}

/** The shortest exact decimal text: no exponent, no trailing fractional zeros. */
function formatDec(d: Dec, shift = 0): string {
  let { digits } = d;
  let scale = d.scale + shift;
  while (scale > 0 && digits.endsWith('0')) {
    digits = digits.slice(0, -1);
    scale -= 1;
  }
  if (digits === '' || /^0+$/.test(digits)) return '0';
  if (scale === 0) return digits;
  const padded = digits.padStart(scale + 1, '0');
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function amountText(v: unknown, shift = 0): string | undefined {
  const d = parseDec(v);
  return d === null ? undefined : formatDec(d, shift);
}

// ---- times ---------------------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** Unix seconds (milliseconds above 10^11) or ISO 8601 text → RFC 3339 UTC; anything else is omitted. */
function timeText(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = Math.trunc(v > 1e11 ? v : v * 1000);
    return formatDate(new Date(ms));
  }
  if (typeof v !== 'string') return undefined;
  const m = ISO.exec(v.trim());
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number) as [number, number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined;
  const ms = Number((m[7] ?? '').slice(0, 3).padEnd(3, '0'));
  let offsetMin = 0;
  const zone = m[8];
  if (zone && zone.toUpperCase() !== 'Z') {
    const z = zone.replace(':', '');
    offsetMin = (z[0] === '-' ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
  }
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms) - offsetMin * 60_000;
  return Number.isFinite(t) ? formatDate(new Date(t)) : undefined;
}

function metadataClick(meta: unknown): string | undefined {
  const m = asObj(meta);
  const id = m?.cg_click_id;
  return isValidClickId(id) ? id : undefined;
}

function aliasList(reference: string, ...vs: unknown[]): string[] | undefined {
  const out: string[] = [];
  for (const v of vs) {
    const a = str(v);
    if (a !== null && a !== reference && !out.includes(a)) out.push(a);
  }
  return out.length ? out.slice(0, 5) : undefined;
}

function finish(body: Record<string, unknown>, options: PaymentHelperOptions | undefined): PaymentConfirmationBody {
  if (options?.clickId != null) body.click_id = options.clickId;
  if (options?.goal != null) body.goal = options.goal;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) out[k] = v;
  return out as PaymentConfirmationBody;
}

function currencyText(v: unknown): string | undefined {
  return str(v)?.toUpperCase() ?? undefined;
}

// ---- the builders (pure) -------------------------------------------------------------------------

/**
 * Build the confirmation body from a Paystack `GET /transaction/verify/{reference}` response (or its `data`),
 * without sending it. Returns null when there is nothing to send. Reads only the reference, status, amount,
 * currency, time, `domain` and `metadata.cg_click_id`.
 *
 * @example
 * const body = buildFromPaystack(verifyResponse); // { provider: 'paystack', reference, status: 'success', amount: '7500', ... }
 */
export function buildFromPaystack(response: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
  const root = asObj(response);
  if (!root) return null;
  const d = unwrap(root, 'data');
  const reference = str(d.reference);
  const status = typeof d.status === 'string' ? PAYSTACK_STATUS[d.status.trim().toLowerCase()] : undefined;
  if (reference === null || !status) return null;
  const domain = str(d.domain);
  return finish(
    {
      provider: Provider.Paystack,
      reference,
      status,
      amount: amountText(d.amount, 2),
      currency: currencyText(d.currency),
      occurred_at: timeText(first(d.paid_at, d.paidAt, d.created_at)),
      test: domain === null ? undefined : domain.toLowerCase() === 'test',
      click_id: metadataClick(d.metadata),
    },
    options,
  );
}

/**
 * Build the confirmation body from a Flutterwave v3 verify response (`GET /v3/transactions/{id}/verify` or
 * `verify_by_reference`, or its `data`), without sending it. Returns null when there is nothing to send.
 *
 * @example
 * const body = buildFromFlutterwave(verifyResponse);
 */
export function buildFromFlutterwave(response: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
  const root = asObj(response);
  if (!root) return null;
  const d = unwrap(root, 'data');
  const reference = str(d.tx_ref) ?? str(d.reference);
  if (reference === null) return null;
  const raw = typeof d.status === 'string' ? d.status.trim().toLowerCase() : '';
  const status: PaymentStatus = raw === 'successful' || raw === 'succeeded' ? 'success' : raw === 'failed' || raw === 'voided' ? 'failed' : 'pending';
  return finish(
    {
      provider: Provider.Flutterwave,
      reference,
      aliases: aliasList(reference, d.id, d.flw_ref),
      status,
      amount: amountText(d.amount),
      currency: currencyText(d.currency),
      occurred_at: timeText(first(d.created_at, d.created_datetime)),
      click_id: metadataClick(d.meta) ?? metadataClick(d.meta_data),
    },
    options,
  );
}

/**
 * Build the confirmation body from a Monnify transaction status response (`GET /api/v2/transactions/{ref}` or
 * the `query?paymentReference=` call, or its `responseBody`; a webhook's `eventData` works too), without sending it.
 * Returns null when there is nothing to send.
 *
 * @example
 * const body = buildFromMonnify(statusResponse);
 */
export function buildFromMonnify(response: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
  const root = asObj(response);
  if (!root) return null;
  const d = unwrap(unwrap(root, 'responseBody'), 'eventData');
  const reference = str(d.paymentReference);
  const status = typeof d.paymentStatus === 'string' ? MONNIFY_STATUS[d.paymentStatus.trim().toUpperCase()] : undefined;
  if (reference === null || !status) return null;
  return finish(
    {
      provider: Provider.Monnify,
      reference,
      aliases: aliasList(reference, d.transactionReference),
      status,
      amount: amountText(d.amountPaid),
      currency: currencyText(first(d.currency, d.currencyCode)),
      occurred_at: timeText(d.paidOn),
      click_id: metadataClick(d.metaData),
    },
    options,
  );
}

const STRIPE_PI_STATUS: Record<string, PaymentStatus> = { succeeded: 'success', canceled: 'failed', processing: 'pending' };

/**
 * Build the confirmation body from a Stripe PaymentIntent (`pi_...`) or Checkout Session (`cs_...`) object,
 * without sending it. Returns null when there is nothing to send (for example a session with
 * `payment_status: 'no_payment_required'`).
 *
 * @example
 * const body = buildFromStripe(paymentIntent);
 */
export function buildFromStripe(object: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
  const o = asObj(object);
  if (!o) return null;
  const currency = currencyText(o.currency);
  const shift = currency !== undefined && STRIPE_ZERO_DECIMAL.has(currency) ? 0 : 2;
  const common = {
    currency,
    occurred_at: timeText(o.created),
    test: typeof o.livemode === 'boolean' ? !o.livemode : undefined,
    click_id: metadataClick(o.metadata),
  };
  if (o.object === 'payment_intent') {
    const raw = typeof o.status === 'string' ? o.status.trim().toLowerCase() : '';
    const status = STRIPE_PI_STATUS[raw] ?? (raw.startsWith('requires_') ? 'pending' : undefined);
    const reference = str(o.id);
    if (!status || reference === null) return null;
    const received = parseDec(o.amount_received);
    const amount = received !== null && received.digits !== '0' ? o.amount_received : o.amount;
    return finish({ provider: Provider.Stripe, reference, status, amount: amountText(amount, shift), ...common }, options);
  }
  if (o.object === 'checkout.session') {
    const paymentStatus = typeof o.payment_status === 'string' ? o.payment_status.trim().toLowerCase() : '';
    if (paymentStatus === 'no_payment_required') return null;
    const status: PaymentStatus = paymentStatus === 'paid' ? 'success' : o.status === 'expired' ? 'failed' : 'pending';
    const sessionId = str(o.id);
    const intent = o.payment_intent;
    const reference = str(isObj(intent) ? intent.id : intent) ?? sessionId;
    if (reference === null) return null;
    return finish(
      { provider: Provider.Stripe, reference, aliases: aliasList(reference, sessionId, o.client_reference_id), status, amount: amountText(o.amount_total, shift), ...common },
      options,
    );
  }
  return null;
}

// ---- confirm: validation and sending -------------------------------------------------------------

function isInteger(v: unknown): v is number | bigint {
  return typeof v === 'bigint' || (typeof v === 'number' && Number.isSafeInteger(v));
}

/** @internal Validate `confirm` params and build the wire body (SPEC 22.2). */
export function buildConfirmWire(core: Core | null, p: PaymentConfirmParams): PaymentConfirmationBody {
  const params = (p ?? {}) as PaymentConfirmParams;
  if (typeof params.provider !== 'string' || !PROVIDER.test(params.provider)) {
    throw localError('invalid_provider', 'provider must be a provider key such as "paystack" or "stripe" (lower case).', 'provider');
  }
  if (typeof params.reference !== 'string' || params.reference.length < 1 || params.reference.length > 128) {
    throw localError('invalid_reference', "reference is required: the gateway's payment reference, 1-128 characters.", 'reference');
  }
  if (typeof params.status !== 'string' || !STATUSES.has(params.status)) {
    throw localError('invalid_status', 'status must be success, partial, pending, failed, refunded or reversed.', 'status');
  }
  const hasAmount = params.amount !== undefined && params.amount !== null;
  const hasMinor = params.amountMinor !== undefined && params.amountMinor !== null;
  if (hasAmount && hasMinor) throw localError('amount_and_amount_minor', 'Send either amount or amountMinor, not both.', 'amount');
  let amount: string | undefined;
  if (hasAmount) {
    try {
      amount = formatValue(params.amount as MoneyInput, (m) => core?.warn('inexact_number', m));
    } catch (err) {
      if (err instanceof ClikgateError) throw localError('invalid_amount', "amount must be a non-negative decimal in normal units, like '7500.00'.", 'amount');
      throw err;
    }
  }
  if (hasMinor && (!isInteger(params.amountMinor) || params.amountMinor < 0)) {
    throw localError('invalid_amount', 'amountMinor must be a non-negative integer (ISO 4217 minor units).', 'amount_minor');
  }
  if (params.currency != null && (typeof params.currency !== 'string' || !CURRENCY.test(params.currency))) {
    throw localError('invalid_currency', 'currency must be an ISO 4217 code such as NGN or USD.', 'currency');
  }
  if (params.aliases != null && (!Array.isArray(params.aliases) || params.aliases.length > 5 || params.aliases.some((a) => typeof a !== 'string'))) {
    throw localError('invalid_aliases', 'aliases must be a list of at most 5 strings.', 'aliases');
  }
  if (params.goal != null && (typeof params.goal !== 'string' || !GOAL_KEY.test(params.goal))) {
    throw localError('invalid_goal_key', 'goal must be a goal key: snake_case, 2-40 characters.', 'goal');
  }
  const wire: Record<string, unknown> = {
    provider: params.provider,
    reference: params.reference,
    status: params.status,
    amount,
    amount_minor: hasMinor ? params.amountMinor : undefined,
    currency: params.currency,
    occurred_at: params.occurredAt == null ? undefined : formatDate(params.occurredAt),
    aliases: params.aliases && params.aliases.length > 0 ? params.aliases : undefined,
    click_id: params.clickId,
    goal: params.goal,
    test: params.test,
    ...(params.extra ?? {}),
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(wire)) if (v !== undefined && v !== null) out[k] = v;
  return out as PaymentConfirmationBody;
}

function bodyToParams(body: PaymentConfirmationBody): PaymentConfirmParams {
  return {
    provider: body.provider,
    reference: body.reference,
    status: body.status,
    amount: body.amount,
    currency: body.currency,
    occurredAt: body.occurred_at,
    aliases: body.aliases,
    clickId: body.click_id,
    goal: body.goal,
    test: body.test,
  };
}

/**
 * Payments confirmed by your server. Call these **right after your own server has verified the payment with the
 * gateway**, never with data from the browser or the app. Clikgate matches the confirmation with the Payment goal
 * your website or app reported (`clikgate.goal('order_paid', { provider, reference })`) and counts it with the
 * confirmed amount. Never pass a gateway key: these methods only talk to Clikgate.
 */
export class Payments {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Confirm a payment your server has verified (`POST /v1/payments/confirmations`). Also for refunds
   * (`status: 'refunded'`, `amount` = the refunded amount).
   *
   * @example
   * // after your own verification with the gateway:
   * await clikgate.payments.confirm({ provider: Provider.Paystack, reference: 'T_ref_001', status: 'success', amount: '7500.00', currency: 'NGN' });
   */
  async confirm(params: PaymentConfirmParams, requestOptions: RequestOptions = {}): Promise<PaymentConfirmation> {
    const body = buildConfirmWire(this.core, params);
    const state = await this.core.guardState();
    if (state.guard) guardPayload('payment_confirmation', body);
    const { data } = await this.core.requester.request<PaymentConfirmation>({ method: 'POST', path: '/v1/payments/confirmations', body, ...requestOptions });
    return data;
  }

  private async send(body: PaymentConfirmationBody | null, gateway: string, quiet = false, requestOptions: RequestOptions = {}): Promise<PaymentConfirmation | null> {
    if (body === null) {
      if (!quiet) this.core.warn('unrecognised_payment_response', `The ${gateway} response has no reference or no status the helper knows; nothing was sent to Clikgate.`);
      return null;
    }
    return this.confirm(bodyToParams(body), requestOptions);
  }

  /**
   * Send a Paystack verify response, right after your own `GET /transaction/verify/{reference}` call.
   * Only the reference, status, amount (÷ 100), currency, time, test flag and `metadata.cg_click_id` are sent.
   * Returns null when there is nothing to send.
   *
   * @example
   * const verify = await paystack.get(`/transaction/verify/${reference}`); // your own call, with your key
   * await clikgate.payments.fromPaystack(verify, { goal: 'order_paid' });
   */
  fromPaystack(response: unknown, options?: PaymentHelperOptions, requestOptions?: RequestOptions): Promise<PaymentConfirmation | null> {
    return this.send(buildFromPaystack(response, options), 'Paystack', false, requestOptions);
  }

  /**
   * Send a Flutterwave verify response, right after your own `GET /v3/transactions/{id}/verify` call.
   *
   * @example
   * const verify = await flutterwave.get(`/v3/transactions/${id}/verify`);
   * await clikgate.payments.fromFlutterwave(verify);
   */
  fromFlutterwave(response: unknown, options?: PaymentHelperOptions, requestOptions?: RequestOptions): Promise<PaymentConfirmation | null> {
    return this.send(buildFromFlutterwave(response, options), 'Flutterwave', false, requestOptions);
  }

  /**
   * Send a Monnify transaction status response, right after your own `GET /api/v2/transactions/{ref}` call.
   *
   * @example
   * const status = await monnify.get(`/api/v2/transactions/${encodeURIComponent(transactionReference)}`);
   * await clikgate.payments.fromMonnify(status);
   */
  fromMonnify(response: unknown, options?: PaymentHelperOptions, requestOptions?: RequestOptions): Promise<PaymentConfirmation | null> {
    return this.send(buildFromMonnify(response, options), 'Monnify', false, requestOptions);
  }

  /**
   * Send a Stripe PaymentIntent or Checkout Session you have retrieved or received in a webhook you verified.
   * A session with `no_payment_required` sends nothing and returns null.
   *
   * @example
   * const intent = await stripe.paymentIntents.retrieve(id);
   * await clikgate.payments.fromStripe(intent);
   */
  fromStripe(object: unknown, options?: PaymentHelperOptions, requestOptions?: RequestOptions): Promise<PaymentConfirmation | null> {
    const o = asObj(object);
    const quiet = o?.object === 'checkout.session' && typeof o.payment_status === 'string' && o.payment_status.trim().toLowerCase() === 'no_payment_required';
    return this.send(buildFromStripe(object, options), 'Stripe', quiet, requestOptions);
  }

  /** {@inheritDoc buildFromPaystack} */
  buildFromPaystack(response: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
    return buildFromPaystack(response, options);
  }

  /** {@inheritDoc buildFromFlutterwave} */
  buildFromFlutterwave(response: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
    return buildFromFlutterwave(response, options);
  }

  /** {@inheritDoc buildFromMonnify} */
  buildFromMonnify(response: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
    return buildFromMonnify(response, options);
  }

  /** {@inheritDoc buildFromStripe} */
  buildFromStripe(object: unknown, options?: PaymentHelperOptions): PaymentConfirmationBody | null {
    return buildFromStripe(object, options);
  }
}
