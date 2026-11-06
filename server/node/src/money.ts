import { localError } from './errors.js';

/** A money amount in normal units (₦2,000,000 is `2000000`). Prefer a decimal string for exact values. */
export type MoneyInput = string | number | bigint;

const DECIMAL = /^[0-9]+(\.[0-9]+)?$/;

/** @internal The warning callback used when a `number` may be inexact. */
export type InexactWarn = (message: string) => void;

function plain(n: number): string {
  const s = String(n);
  if (!/e/i.test(s)) return s;
  if (Number.isInteger(n)) return BigInt(n).toString();
  return n.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Format a money value for the wire: always a plain decimal string (SPEC section 8).
 *
 * - strings are trimmed and must look like `2000000` or `1500.50` (no signs, exponents or separators);
 * - integers and bigints are sent as their digits;
 * - non-integer numbers are sent as their shortest decimal form, with an `inexact_number` warning.
 *
 * @throws {InvalidRequestError} code `invalid_value` for anything else.
 * @example
 * formatValue('1500.50'); // '1500.50'
 * formatValue(2_000_000); // '2000000'
 * formatValue(10n ** 18n); // '1000000000000000000'
 */
export function formatValue(value: MoneyInput, warn?: InexactWarn): string {
  const bad = (why: string) => localError('invalid_value', `value ${why}. Pass a decimal string in normal units, like '1500.50'.`, 'value');
  if (typeof value === 'string') {
    const s = value.trim();
    if (!DECIMAL.test(s)) throw bad('must be a non-negative decimal number');
    return s;
  }
  if (typeof value === 'bigint') {
    if (value < 0n) throw bad('must not be negative');
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw bad('must be a finite number');
    if (value < 0) throw bad('must not be negative');
    if (Number.isSafeInteger(value)) return String(value);
    warn?.(`value ${String(value)} is a floating-point number and may not be exact; pass a decimal string, like '1500.50', for exact values.`);
    return plain(value);
  }
  throw bad(`has unsupported type ${value === null ? 'null' : typeof value}`);
}
