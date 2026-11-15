/**
 * Your customer IDs, in one canonical form (change 26 KC.1, R.24): the same form the API stores and checks, so an ID
 * sent from your server, an import and an identity token always match.
 *
 * - canonical form: Unicode NFC, trimmed of Unicode whitespace (and U+FEFF) at both ends, case kept;
 * - warnings (first match wins): `empty`, `too_long` (more than 128 characters), `looks_like_email`,
 *   `looks_like_national_id` (exactly 11 digits, unless `allow11DigitIds`), `looks_like_phone`.
 *
 * Use your own stable user ID (for example `u_10482`), never an email, phone number, BVN or NIN.
 */

/** Unicode White_Space characters plus U+FEFF (the byte-order mark). */
const TRIM = '\t\n\u000b\u000c\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
/** The longest customer ID kept as a known customer, in Unicode code points. */
export const CUSTOMER_ID_MAX_LENGTH = 128;

/** Why a customer ID can't be used as a known customer (the API's refusal reasons for the same checks). */
export type CustomerIdWarning = 'empty' | 'too_long' | 'looks_like_email' | 'looks_like_national_id' | 'looks_like_phone';

/** The canonical form of a customer ID: NFC, trimmed, case kept. */
export function canonicalCustomerId(customerId: string): string {
  const s = customerId.normalize('NFC');
  let start = 0;
  let end = s.length;
  while (start < end && TRIM.includes(s[start] as string)) start++;
  while (end > start && TRIM.includes(s[end - 1] as string)) end--;
  return s.slice(start, end);
}

/**
 * Why Clikgate wouldn't keep this ID as a known customer, or `null` when it's fine.
 *
 * @example
 * customerIdWarning('ada@example.com'); // 'looks_like_email'
 * customerIdWarning('u_10482');         // null
 */
export function customerIdWarning(customerId: string, options: { allow11DigitIds?: boolean } = {}): CustomerIdWarning | null {
  const cid = canonicalCustomerId(customerId);
  if (cid === '') return 'empty';
  if ([...cid].length > CUSTOMER_ID_MAX_LENGTH) return 'too_long';
  const at = cid.indexOf('@');
  if (at >= 0 && cid.slice(at + 1).includes('.')) return 'looks_like_email';
  if (/^[0-9]{11}$/.test(cid)) return options.allow11DigitIds ? null : 'looks_like_national_id';
  if (/^\+?[0-9]{10,15}$/.test(cid.replace(/[ -]/g, ''))) return 'looks_like_phone';
  return null;
}
