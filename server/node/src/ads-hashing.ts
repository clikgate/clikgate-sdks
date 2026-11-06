import { createHash } from 'node:crypto';
import { localError } from './errors.js';

/**
 * Hashed email and phone for ad network matching. The values Clikgate accepts as
 * `hashed_email`, `hashed_phone_e164` and `hashed_phone_digits`: SHA-256 as 64 lowercase hex characters.
 */
export interface HashedIdentifiers {
  /** SHA-256 of the email, trimmed and lowercased. */
  hashedEmail?: string;
  /** SHA-256 of the phone in E.164 with the `+` (`+2348031234567`). */
  hashedPhoneE164?: string;
  /** SHA-256 of the phone digits with the country code, no `+` (`2348031234567`). */
  hashedPhoneDigits?: string;
}

/** Input of {@link hashForAds}. Leave a field out (or null) to hash only the other one. */
export interface HashForAdsInput {
  /** The customer's email. */
  email?: string | null;
  /** The customer's phone, with its country code (`+234 803 123 4567` or `00234…`). */
  phone?: string | null;
}

/** @internal The wire fields and their option names. */
export const HASHED_FIELDS = [
  ['hashed_email', 'hashedEmail'],
  ['hashed_phone_e164', 'hashedPhoneE164'],
  ['hashed_phone_digits', 'hashedPhoneDigits'],
] as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/**
 * Normalise and hash an email and / or phone on your own server, for a goal's ad network matching
 * (`hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits`). Pure and offline. In private mode Clikgate never
 * hashes for you: hash on your server with this helper and send only the hashes.
 *
 * - email: trimmed and lowercased; it must contain `@`.
 * - phone: must include its country code (start with `+` or `00`); spaces and punctuation are removed, and the
 *   result must be 7–15 digits starting with 1–9. A national number such as `0803 123 4567` is refused.
 *
 * @throws {InvalidRequestError} `invalid_argument` (param `email` or `phone`); the input is never in the message.
 * @example
 * clikgate.goal('account_opened', {
 *   reference: 'APP-55231',
 *   clickId,
 *   ...hashForAds({ email: customer.email, phone: customer.phone }), // e.g. '+234 803 123 4567'
 * });
 */
export function hashForAds(input: HashForAdsInput): HashedIdentifiers {
  const out: HashedIdentifiers = {};
  const { email, phone } = input ?? {};
  if (email != null) {
    const value = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!value.includes('@')) throw localError('invalid_argument', 'email must be an email address (it contains @).', 'email');
    out.hashedEmail = sha256(value);
  }
  if (phone != null) {
    const trimmed = typeof phone === 'string' ? phone.trim() : '';
    let digits = trimmed.replace(/\D/g, '');
    if (trimmed.startsWith('00')) digits = digits.slice(2);
    else if (!trimmed.startsWith('+')) digits = '';
    if (!/^[1-9]\d{6,14}$/.test(digits)) {
      throw localError('invalid_argument', 'phone must include its country code, e.g. "+234 803 123 4567" (7-15 digits after the +).', 'phone');
    }
    out.hashedPhoneE164 = sha256(`+${digits}`);
    out.hashedPhoneDigits = sha256(digits);
  }
  return out;
}

/** @internal Refuse a hashed wire field that isn't 64 lowercase hex characters (the value is never echoed). */
export function checkHashedFields(wire: Record<string, unknown>): void {
  for (const [field] of HASHED_FIELDS) {
    const v = wire[field];
    if (v == null) continue;
    if (typeof v !== 'string' || !SHA256_HEX.test(v)) {
      throw localError('invalid_hashed_identifier', `${field} must be a SHA-256 hash as 64 lowercase hex characters (use hashForAds).`, field);
    }
  }
}
