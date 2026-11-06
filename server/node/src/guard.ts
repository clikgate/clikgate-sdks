import { PrivateModeFieldRejectedError } from './errors.js';

/**
 * Wire fields allowed in private mode (SPEC 12.2). `label` is allowed: the API accepts it in private mode only when
 * an Owner switched on "Allow labels in private mode" (`422 labels_off_in_private_mode` otherwise; SPEC 24). The three
 * hashed identifiers (SPEC 25) are allowed on goals and conversions: the API accepts them in private mode only
 * while a destination matches by hashed email or phone.
 */
export const PRIVATE_ALLOWED = {
  goal: new Set(['goal', 'click_id', 'code', 'reference', 'value', 'currency', 'is_first', 'occurred_at', 'consent', 'provider', 'kept_by', 'browser_engine', 'platform', 'label', 'hashed_email', 'hashed_phone_e164', 'hashed_phone_digits']),
  conversion: new Set(['goal', 'click_id', 'code', 'reference', 'value', 'currency', 'is_first', 'occurred_at', 'consent', 'provider', 'kept_by', 'browser_engine', 'platform', 'external_id', 'hashed_email', 'hashed_phone_e164', 'hashed_phone_digits']),
  identify: new Set(['click_id', 'app_id', 'installation_id', 'label']),
  reversal: new Set(['goal', 'reference', 'value', 'external_id', 'amount_minor']),
  payment_confirmation: new Set(['provider', 'reference', 'status', 'amount', 'amount_minor', 'currency', 'occurred_at', 'aliases', 'click_id', 'goal', 'test', 'refund_id', 'source_plugin']),
} as const;

/** The kind of payload the guard checks. */
export type GuardKind = keyof typeof PRIVATE_ALLOWED;

/** The value shown instead of a reference while private mode is on. */
export const REDACTED = '[redacted]';

/**
 * @internal Throw PrivateModeFieldRejectedError for the first refused (non-null) wire field:
 * `metadata`, then `consent`, then the rest alphabetically. The message names the field only.
 */
export function guardPayload(kind: GuardKind, wire: Record<string, unknown>): void {
  const allowed = PRIVATE_ALLOWED[kind];
  const refused = Object.keys(wire).filter((k) => wire[k] !== undefined && wire[k] !== null && !allowed.has(k));
  if (refused.length === 0) return;
  const rank = (k: string) => (k === 'metadata' ? 0 : k === 'consent' ? 1 : 2);
  refused.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const field = refused[0] as string;
  throw new PrivateModeFieldRejectedError({
    message: `Private mode is on: the field "${field}" can't be sent. Only ${[...allowed].join(', ')} are allowed.`,
    code: 'private_mode_field_rejected',
    param: field,
    field,
    httpStatus: null,
  });
}
