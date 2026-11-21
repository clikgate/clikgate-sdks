import type { Referral, ReferrerResult, Referrer, RewardInfo, RewardSide } from './models.js';

/** ISO 4217 exponents other than 2 (the backend's list); every other code has 2. */
const EXPONENTS: Record<string, number> = {
  BHD: 3, BIF: 0, CLF: 4, CLP: 0, DJF: 0, GNF: 0, IQD: 3, ISK: 0, JOD: 3, JPY: 0, KMF: 0, KRW: 0, KWD: 3,
  LYD: 3, OMR: 3, PYG: 0, RWF: 0, TND: 3, UGX: 0, UYI: 0, UYW: 4, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
};

/** The ISO 4217 minor-unit exponent of a currency (2 when unknown). */
export function currencyExponent(currency: string): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

/**
 * Minor units to a decimal string in normal units, with exactly the currency's exponent of fraction digits
 * (`50000` NGN → `"500.00"`, `1500` JPY → `"1500"`). No float is involved.
 */
export function minorToAmount(amountMinor: number | bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const n = typeof amountMinor === 'bigint' ? amountMinor : BigInt(Math.trunc(amountMinor));
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(exp + 1, '0');
  const whole = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return negative ? `-${whole}` : whole;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function side(v: unknown): RewardSide | undefined {
  if (!isObject(v)) return v as undefined;
  const out: RewardSide = { ...v };
  if ((typeof v.amount_minor === 'number' || typeof v.amount_minor === 'bigint') && typeof v.currency === 'string' && v.currency !== '') {
    out.amount = minorToAmount(v.amount_minor, v.currency);
  }
  return out;
}

/** @internal Add `amount` next to each reward side's `amount_minor`. */
export function rewardInfo(v: unknown): RewardInfo | undefined {
  if (!isObject(v)) return v as undefined;
  const out: RewardInfo = { ...v };
  if ('referrer' in v) out.referrer = side(v.referrer);
  if ('referee' in v) out.referee = side(v.referee);
  return out;
}

/** @internal A referral with reward amounts. */
export function toReferral(data: unknown): Referral {
  if (!isObject(data)) return data as Referral;
  const out = { ...data } as Referral;
  if (isObject(data.reward_snapshot)) out.reward_snapshot = rewardInfo(data.reward_snapshot);
  if (isObject(data.referrer)) out.referrer = { ...data.referrer, customerId: data.referrer.customer_user_id } as Referral['referrer'];
  if (isObject(data.referee)) out.referee = { ...data.referee, customerId: data.referee.customer_user_id ?? null } as Referral['referee'];
  return out;
}

/** @internal A referrer with `customerId` next to `customer_user_id`. */
export function toReferrer(data: unknown): Referrer {
  if (!isObject(data)) return data as Referrer;
  return { ...data, customerId: data.customer_user_id } as Referrer;
}

/** @internal A referrer with `created`. */
export function toReferrerResult(data: unknown, status: number): ReferrerResult {
  return { ...toReferrer(data), created: status === 201 };
}
