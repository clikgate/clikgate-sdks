import type { Core } from './core.js';
import { NotFoundError, localError } from './errors.js';
import { encodePathSegment, formatDate, requireId, type RequestOptions } from './http.js';
import { formatValue, type MoneyInput } from './money.js';
import { toReferral, toReferrer, toReferrerResult } from './currency.js';
import { defined, paginate, type PageIterator } from './pager.js';
import type { Job, Referral, Referrer, ReferrerResult } from './models.js';
import type { ListPage } from './types.js';

/** Fields of `referrals.getOrCreateReferrer`. */
export interface ReferrerCreateParams {
  /** Your customer ID (sent as `customer_user_id`). */
  customerId: string;
  displayName?: string;
  /** A code the customer already had in your own system. */
  externalCode?: string;
}

/** Look a referrer up by your customer ID or by their code (exactly one). */
export type ReferrerLookup = { customerId: string; code?: undefined } | { code: string; customerId?: undefined };

/** Filters of `referrals.list` / `listPage`. */
export interface ReferralListParams {
  programId?: string;
  referrerId?: string;
  /** The referee's customer ID (sent as `referee_customer_user_id`). */
  refereeCustomerId?: string;
  status?: string;
  from?: Date | string;
  to?: Date | string;
  /** 1-100 per page. */
  limit?: number;
  startingAfter?: string;
  endingBefore?: string;
}

/** Fields of `referrals.completeStep`. */
export interface CompleteStepParams {
  /** The step's goal key. */
  goal: string;
  /** When the step happened (required by the API). */
  occurredAt: Date | string;
  /** Normal units (SPEC section 8). */
  value?: MoneyInput;
  currency?: string;
}

/** One row of `referrals.importReferrers`. */
export interface ReferrerImportRow {
  customerId: string;
  externalCode?: string;
  displayName?: string;
}

/** Fields of `referrals.updateReferrer`. */
export interface ReferrerUpdateParams {
  displayName?: string | null;
  /** Your own free-form data about the referrer. */
  attributes?: Record<string, unknown> | null;
}

/** The API's limit of referrers per import request. */
export const REFERRER_IMPORT_BATCH = 1000;

/** Referrals: referrers, referrals, manual overrides, qualification steps and imports. */
export class Referrals {
  /** @internal */
  constructor(private readonly core: Core) {}

  private async call<T>(method: 'GET' | 'POST' | 'PATCH', path: string, init: { body?: unknown; query?: Record<string, unknown> }, requestOptions: RequestOptions): Promise<{ status: number; data: T }> {
    const { status, data } = await this.core.requester.request<T>({ method, path, ...init, ...requestOptions });
    return { status, data };
  }

  /**
   * Get the referrer for one of your customers in a program, creating it (with its code and link) the first time.
   * `created` is true when it was just created.
   *
   * @example
   * const referrer = await clikgate.referrals.getOrCreateReferrer('rpg_01J…', { customerId: user.id, displayName: user.firstName });
   * console.log(referrer.code, referrer.url, referrer.created);
   */
  async getOrCreateReferrer(programId: string, params: ReferrerCreateParams, requestOptions: RequestOptions = {}): Promise<ReferrerResult> {
    const program = encodePathSegment(requireId(programId, 'program_id'));
    const body = defined({ customer_user_id: requireId(params?.customerId, 'customer_id'), display_name: params.displayName, external_code: params.externalCode });
    const { status, data } = await this.call<unknown>('POST', `/v1/referral-programs/${program}/referrers`, { body }, requestOptions);
    return toReferrerResult(data, status);
  }

  /**
   * Fetch a referrer by ID.
   *
   * @example
   * const referrer = await clikgate.referrals.getReferrer('rfr_01J…');
   */
  async getReferrer(referrerId: string, requestOptions: RequestOptions = {}): Promise<Referrer> {
    const { data } = await this.call<unknown>('GET', `/v1/referrers/${encodePathSegment(requireId(referrerId, 'referrer_id'))}`, {}, requestOptions);
    return toReferrer(data);
  }

  /**
   * Find a referrer by your customer ID or by code. Returns `null` when there is none (404); other errors throw.
   *
   * @example
   * const referrer = await clikgate.referrals.findReferrer('rpg_01J…', { customerId: user.id });
   * if (!referrer) { … }
   */
  async findReferrer(programId: string, lookup: ReferrerLookup, requestOptions: RequestOptions = {}): Promise<Referrer | null> {
    const program = encodePathSegment(requireId(programId, 'program_id'));
    const hasCustomer = lookup?.customerId !== undefined && lookup?.customerId !== null;
    const hasCode = lookup?.code !== undefined && lookup?.code !== null;
    if (hasCustomer === hasCode) throw localError('invalid_argument', 'Pass exactly one of customerId and code.', 'customer_id');
    const path = hasCustomer
      ? `/v1/referral-programs/${program}/referrers/by-user/${encodePathSegment(requireId(lookup.customerId, 'customer_id'))}`
      : `/v1/referral-programs/${program}/referrers/by-code/${encodePathSegment(requireId(lookup.code, 'code'))}`;
    try {
      const { data } = await this.call<unknown>('GET', path, {}, requestOptions);
      return toReferrer(data);
    } catch (err) {
      if (err instanceof NotFoundError) return null;
      throw err;
    }
  }

  /**
   * Fetch a referral by ID. Reward sides carry `amount` (normal units) next to `amount_minor`.
   *
   * @example
   * const referral = await clikgate.referrals.get('ref_01J…');
   * console.log(referral.status, referral.reward_snapshot?.referrer?.amount);
   */
  async get(referralId: string, requestOptions: RequestOptions = {}): Promise<Referral> {
    const { data } = await this.call<unknown>('GET', `/v1/referrals/${encodePathSegment(requireId(referralId, 'referral_id'))}`, {}, requestOptions);
    return toReferral(data);
  }

  /**
   * Fetch one page of referrals.
   *
   * @example
   * const page = await clikgate.referrals.listPage({ programId: 'rpg_01J…', status: 'qualified', limit: 100 });
   */
  async listPage(params: ReferralListParams = {}, requestOptions: RequestOptions = {}): Promise<ListPage<Referral>> {
    const query = defined({
      program_id: params.programId,
      referrer_id: params.referrerId,
      referee_customer_user_id: params.refereeCustomerId,
      status: params.status,
      from: params.from,
      to: params.to,
      limit: params.limit,
      starting_after: params.startingAfter,
      ending_before: params.endingBefore,
    });
    const { data } = await this.call<ListPage<unknown>>('GET', '/v1/referrals', { query }, requestOptions);
    return { ...data, data: (data?.data ?? []).map(toReferral) };
  }

  /**
   * Iterate over every referral, fetching pages lazily.
   *
   * @example
   * for await (const referral of clikgate.referrals.list({ programId: 'rpg_01J…', status: 'qualified' })) {
   *   console.log(referral.id, referral.referee.customer_user_id);
   * }
   */
  list(params: ReferralListParams = {}, requestOptions: RequestOptions = {}): PageIterator<Referral> {
    return paginate((cursor) => this.listPage(cursor ? { ...params, startingAfter: cursor } : params, requestOptions));
  }

  /**
   * Qualify a referral by hand (a manual override), with your reason.
   *
   * @example
   * await clikgate.referrals.qualify('ref_01J…', { reason: 'Checked by support' });
   */
  async qualify(referralId: string, params: { reason: string }, requestOptions: RequestOptions = {}): Promise<Referral> {
    return this.override(referralId, 'qualify', params?.reason, requestOptions);
  }

  /**
   * Disqualify a referral by hand (a manual override), with your reason.
   *
   * @example
   * await clikgate.referrals.disqualify('ref_01J…', { reason: 'Same household' });
   */
  async disqualify(referralId: string, params: { reason: string }, requestOptions: RequestOptions = {}): Promise<Referral> {
    return this.override(referralId, 'disqualify', params?.reason, requestOptions);
  }

  private async override(referralId: string, action: 'qualify' | 'disqualify', reason: string, requestOptions: RequestOptions): Promise<Referral> {
    const path = `/v1/referrals/${encodePathSegment(requireId(referralId, 'referral_id'))}/override`;
    const { data } = await this.call<unknown>('POST', path, { body: { action, reason } }, requestOptions);
    return toReferral(data);
  }

  /**
   * Complete the referral's current qualification step from your server (a goal it can't see otherwise).
   *
   * @example
   * await clikgate.referrals.completeStep('ref_01J…', { goal: 'first_order', occurredAt: order.paidAt, value: '1500.50', currency: 'NGN' });
   */
  async completeStep(referralId: string, params: CompleteStepParams, requestOptions: RequestOptions = {}): Promise<Referral> {
    const path = `/v1/referrals/${encodePathSegment(requireId(referralId, 'referral_id'))}/steps`;
    if (params?.occurredAt === undefined || params.occurredAt === null || params.occurredAt === '') throw localError('invalid_argument', 'occurredAt is required: when the step happened.', 'occurred_at');
    const value = params.value === undefined || params.value === null ? undefined : formatValue(params.value, (m) => this.core.warn('inexact_number', m));
    const body = defined({ goal: params.goal, occurred_at: formatDate(params.occurredAt), value, currency: params.currency });
    const { data } = await this.call<unknown>('POST', path, { body }, requestOptions);
    return toReferral(data);
  }

  /**
   * Import referrers (customers who already refer others, with their old codes). Rows are sent in batches of 1000;
   * the result is one job per batch.
   *
   * @example
   * const jobs = await clikgate.referrals.importReferrers('rpg_01J…', [{ customerId: 'user-42', externalCode: 'ADA-OLD' }]);
   */
  async importReferrers(programId: string, rows: ReferrerImportRow[], requestOptions: RequestOptions = {}): Promise<Job[]> {
    const program = encodePathSegment(requireId(programId, 'program_id'));
    if (!Array.isArray(rows)) throw localError('invalid_argument', 'rows must be a list.', 'rows');
    const wire = rows.map((r, i) => defined({ customer_user_id: requireId(r?.customerId, `rows[${i}].customer_id`), external_code: r.externalCode, display_name: r.displayName }));
    const jobs: Job[] = [];
    const batches = Math.ceil(wire.length / REFERRER_IMPORT_BATCH);
    for (let b = 0; b < batches; b++) {
      const key = requestOptions.idempotencyKey && batches > 1 ? `${requestOptions.idempotencyKey}-${b}` : requestOptions.idempotencyKey;
      const body = { referrers: wire.slice(b * REFERRER_IMPORT_BATCH, (b + 1) * REFERRER_IMPORT_BATCH) };
      const { data } = await this.call<Job>('POST', `/v1/referral-programs/${program}/referrers/import`, { body }, { ...requestOptions, idempotencyKey: key });
      jobs.push(data);
    }
    return jobs;
  }

  /**
   * Block a referrer: their code and link stop creating referrals.
   *
   * @example
   * await clikgate.referrals.blockReferrer('rfr_01J…', { reason: 'Fake installs' });
   */
  async blockReferrer(referrerId: string, params: { reason?: string } = {}, requestOptions: RequestOptions = {}): Promise<Referrer> {
    const path = `/v1/referrers/${encodePathSegment(requireId(referrerId, 'referrer_id'))}/block`;
    const { data } = await this.call<unknown>('POST', path, { body: defined({ reason: params?.reason }) }, requestOptions);
    return toReferrer(data);
  }

  /**
   * Unblock a referrer.
   *
   * @example
   * await clikgate.referrals.unblockReferrer('rfr_01J…');
   */
  async unblockReferrer(referrerId: string, requestOptions: RequestOptions = {}): Promise<Referrer> {
    const { data } = await this.call<unknown>('POST', `/v1/referrers/${encodePathSegment(requireId(referrerId, 'referrer_id'))}/unblock`, {}, requestOptions);
    return toReferrer(data);
  }

  /**
   * Update a referrer's display name or your own attributes (`null` clears).
   *
   * @example
   * await clikgate.referrals.updateReferrer('rfr_01J…', { displayName: 'Ada O.', attributes: { tier: 'gold' } });
   */
  async updateReferrer(referrerId: string, params: ReferrerUpdateParams, requestOptions: RequestOptions = {}): Promise<Referrer> {
    const body = defined({ display_name: params?.displayName, attributes: params?.attributes });
    const { data } = await this.call<unknown>('PATCH', `/v1/referrers/${encodePathSegment(requireId(referrerId, 'referrer_id'))}`, { body }, requestOptions);
    return toReferrer(data);
  }
}
