import type { Core } from './core.js';
import { ConflictError, localError } from './errors.js';
import type { RequestOptions } from './http.js';

/**
 * Known customers: people who were already your customers before you added Clikgate. Clikgate uses
 * them so an existing customer is never counted as a referral or a new customer. It stores a keyed fingerprint of
 * each ID, not the ID itself. Not available in private mode.
 */

/** One existing customer: your customer ID and, optionally, when they became a customer. */
export interface KnownCustomer {
  customerId: string;
  /** When they became a customer: `'YYYY-MM-DD'`, a `Date` or Unix seconds. Only the UTC day is sent. */
  customerSince?: string | Date | number | null;
}

/** Why rows were refused. Counts only: the API never returns the refused IDs. */
export type KnownCustomerRefusal = 'looks_like_email' | 'looks_like_phone' | 'looks_like_national_id' | 'empty' | 'too_long' | 'bad_date' | 'date_out_of_range';

/** The answer of `knownCustomers.import()`, summed over every batch. */
export interface KnownCustomersImportResult {
  accepted: number;
  refused: number;
  refused_by_reason: Partial<Record<KnownCustomerRefusal | string, number>>;
}

/** The API's batch size; `import()` splits larger lists. */
export const KNOWN_CUSTOMERS_BATCH = 10_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** @internal The UTC day `YYYY-MM-DD` of a customerSince value. */
export function sinceDay(value: string | Date | number): string {
  if (typeof value === 'string') {
    if (!DAY.test(value)) throw localError('invalid_argument', "customerSince must be 'YYYY-MM-DD', a Date or Unix seconds.", 'customer_since');
    return value;
  }
  const ms = typeof value === 'number' ? value * 1000 : value instanceof Date ? value.getTime() : Number.NaN;
  if (!Number.isFinite(ms) || (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw localError('invalid_argument', "customerSince must be 'YYYY-MM-DD', a Date or Unix seconds.", 'customer_since');
  }
  return new Date(ms).toISOString().slice(0, 10);
}

function privateModeConflict(): ConflictError {
  return new ConflictError({
    message: "Private mode is on: known customers can't be imported or removed.",
    code: 'private_mode_conflict',
    httpStatus: null,
  });
}

/** `clikgate.knownCustomers`: import and remove existing customers (scope `people:write`). */
export class KnownCustomers {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Import existing customers (`POST /v1/known-customers/import`), in batches of 10,000. Idempotent per customer ID.
   * Use your own customer IDs, never emails or phone numbers. The result sums every batch; refused rows are counted
   * by reason, never returned.
   *
   * @example
   * const result = await clikgate.knownCustomers.import([{ customerId: 'u_10482', customerSince: '2024-03-02' }]);
   * console.log(result.accepted, result.refused_by_reason);
   */
  async import(customers: readonly KnownCustomer[], requestOptions: RequestOptions = {}): Promise<KnownCustomersImportResult> {
    if (!Array.isArray(customers)) throw localError('invalid_argument', 'customers must be an array.', 'customers');
    const rows = customers.map((c, i) => {
      if (!c || typeof c.customerId !== 'string') throw localError('invalid_argument', `customers[${i}].customerId must be a string.`, 'customer_id');
      const row: Record<string, string> = { customer_id: c.customerId };
      if (c.customerSince != null) row.customer_since = sinceDay(c.customerSince);
      return row;
    });
    const total: KnownCustomersImportResult = { accepted: 0, refused: 0, refused_by_reason: {} };
    if (rows.length === 0) return total;
    if ((await this.core.guardState()).guard) throw privateModeConflict();
    const several = rows.length > KNOWN_CUSTOMERS_BATCH;
    for (let i = 0; i < rows.length; i += KNOWN_CUSTOMERS_BATCH) {
      // One idempotency key per batch: a key you pass gets the batch number appended
      const key = requestOptions.idempotencyKey;
      const options = several && key ? { ...requestOptions, idempotencyKey: `${key}-${i / KNOWN_CUSTOMERS_BATCH}` } : requestOptions;
      const { data } = await this.core.requester.request<KnownCustomersImportResult>({
        method: 'POST',
        path: '/v1/known-customers/import',
        body: { customers: rows.slice(i, i + KNOWN_CUSTOMERS_BATCH) },
        ...options,
      });
      total.accepted += data.accepted ?? 0;
      total.refused += data.refused ?? 0;
      for (const [reason, n] of Object.entries(data.refused_by_reason ?? {})) {
        total.refused_by_reason[reason] = (total.refused_by_reason[reason] ?? 0) + (n ?? 0);
      }
    }
    return total;
  }

  /**
   * Remove one imported customer (`POST /v1/known-customers/remove`; the ID travels in the body, never in a URL).
   *
   * @example
   * const { removed } = await clikgate.knownCustomers.remove('u_10482');
   */
  async remove(customerId: string, requestOptions: RequestOptions = {}): Promise<{ removed: boolean }> {
    if (typeof customerId !== 'string' || customerId === '') throw localError('invalid_customer_id', 'customerId must be a non-empty string.', 'customer_id');
    if ((await this.core.guardState()).guard) throw privateModeConflict();
    const { data } = await this.core.requester.request<{ removed: boolean }>({ method: 'POST', path: '/v1/known-customers/remove', body: { customer_id: customerId }, ...requestOptions });
    return data;
  }
}
