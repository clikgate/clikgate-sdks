import type { Core } from './core.js';
import { encodePathSegment, formatDate, requireId, type RequestOptions } from './http.js';
import { toReferral } from './currency.js';
import { defined, paginate, type PageIterator } from './pager.js';
import type { CodeRedemption, Install, Person, PersonSearchPage, PersonSummary, PrivacyRequest } from './models.js';

/** Fields of `privacy.createRequest`. */
export interface PrivacyRequestParams {
  type: 'access' | 'export' | 'delete' | 'erasure' | (string & {});
  subjectType: 'installation' | 'customer_user' | 'email' | 'phone' | 'person' | 'click' | (string & {});
  subjectId: string;
  appId?: string;
}

/** Privacy requests: access, export, delete or erase a subject's data. */
export class Privacy {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Ask for a subject's data to be exported, or erased. The request completes in the background.
   *
   * @example
   * const request = await clikgate.privacy.createRequest({ type: 'erasure', subjectType: 'customer_user', subjectId: user.id });
   */
  async createRequest(params: PrivacyRequestParams, requestOptions: RequestOptions = {}): Promise<PrivacyRequest> {
    const body = defined({ type: params.type, subject_type: params.subjectType, subject_id: params.subjectId, app_id: params.appId });
    const { data } = await this.core.requester.request<PrivacyRequest>({ method: 'POST', path: '/v1/privacy/requests', body, ...requestOptions });
    return data;
  }

  /**
   * Fetch a privacy request (an export's `result` has its download link once completed).
   *
   * @example
   * const request = await clikgate.privacy.getRequest('prq_01J…');
   */
  async getRequest(requestId: string, requestOptions: RequestOptions = {}): Promise<PrivacyRequest> {
    const path = `/v1/privacy/requests/${encodePathSegment(requireId(requestId, 'request_id'))}`;
    const { data } = await this.core.requester.request<PrivacyRequest>({ method: 'GET', path, ...requestOptions });
    return data;
  }
}

/** Options of `people.searchPage`. */
export interface PeopleSearchOptions {
  cursor?: string;
  /** 1-50 per page. */
  limit?: number;
}

/** People: one customer across clicks, installs and your customer ID. */
export class People {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Fetch a person.
   *
   * @example
   * const person = await clikgate.people.get('per_01J…');
   */
  async get(personId: string, requestOptions: RequestOptions = {}): Promise<Person> {
    const { data } = await this.core.requester.request<Person>({ method: 'GET', path: `/v1/people/${encodePathSegment(requireId(personId, 'person_id'))}`, ...requestOptions });
    return data;
  }

  /**
   * Fetch one page of people matching a label, customer ID or click ID. The text is sent in the body, never in the URL.
   *
   * @example
   * const page = await clikgate.people.searchPage('Ada', { limit: 20 });
   */
  async searchPage(q: string, options: PeopleSearchOptions = {}, requestOptions: RequestOptions = {}): Promise<PersonSearchPage> {
    const body = defined({ q, cursor: options.cursor, limit: options.limit });
    const { data } = await this.core.requester.request<PersonSearchPage>({ method: 'POST', path: '/v1/people/search', body, ...requestOptions });
    return data;
  }

  /**
   * Iterate over every person matching the text, fetching pages lazily.
   *
   * @example
   * for await (const person of clikgate.people.search('Ada')) console.log(person.id, person.label);
   */
  search(q: string, options: Omit<PeopleSearchOptions, 'cursor'> = {}, requestOptions: RequestOptions = {}): PageIterator<PersonSummary> {
    return paginate((cursor) => this.searchPage(q, { ...options, cursor: cursor ?? undefined }, requestOptions));
  }

  /**
   * Set a person's label (`null` clears it).
   *
   * @example
   * await clikgate.people.setLabel('per_01J…', 'Ada (VIP)');
   */
  async setLabel(personId: string, label: string | null, requestOptions: RequestOptions = {}): Promise<Person> {
    const { data } = await this.core.requester.request<Person>({ method: 'PATCH', path: `/v1/people/${encodePathSegment(requireId(personId, 'person_id'))}`, body: { label }, ...requestOptions });
    return data;
  }
}

/** Installs of your apps. */
export class Installs {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * The latest install of one of your customers (the customer ID you sent with `identifyUser`).
   * The API currently needs `appId`.
   *
   * @example
   * const install = await clikgate.installs.getByCustomer(user.id, { appId: 'app_01J…' });
   */
  async getByCustomer(customerId: string, options: { appId?: string } = {}, requestOptions: RequestOptions = {}): Promise<Install> {
    const path = `/v1/installs/by-customer-user/${encodePathSegment(requireId(customerId, 'customer_id'))}`;
    const { data } = await this.core.requester.request<Install>({ method: 'GET', path, query: defined({ app_id: options.appId }), ...requestOptions });
    return data;
  }

  /**
   * An install by its installation ID (from the `Clikgate-Installation` header). The API currently needs `appId`.
   *
   * @example
   * const install = await clikgate.installs.getByInstallation(installation.installationId, { appId: installation.appId });
   */
  async getByInstallation(installationId: string, options: { appId?: string } = {}, requestOptions: RequestOptions = {}): Promise<Install> {
    const path = `/v1/installs/by-installation/${encodePathSegment(requireId(installationId, 'installation_id'))}`;
    const { data } = await this.core.requester.request<Install>({ method: 'GET', path, query: defined({ app_id: options.appId }), ...requestOptions });
    return data;
  }
}

/** Fields of `codes.redeem`. */
export interface CodeRedeemParams {
  /** Your ID for this redemption (a receipt or ticket number). */
  externalId: string;
  code: string;
  channel: 'ussd' | 'sms_keyword' | 'agent' | 'pos' | 'in_store' | 'call_center' | 'event' | 'print' | 'radio' | 'other' | (string & {});
  appId?: string;
  occurredAt?: Date | string;
  /** Your own free-form data. */
  metadata?: Record<string, unknown>;
  /** Who redeemed it: `{ type, id? }` (e.g. `{ type: 'customer_user', id: user.id }`), sent as given. */
  subject?: { type: string; id?: string | null; [key: string]: unknown };
  /** The agent who took the redemption. */
  agentId?: string;
  /** Where: `{ country?, region?, city?, store_id? }`, sent as given. */
  location?: { country?: string | null; region?: string | null; city?: string | null; store_id?: string | null; [key: string]: unknown };
}

/** Offline and referral codes. */
export class Codes {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Redeem a code received offline (USSD, a till, an agent). A referral code can create a referral.
   *
   * @example
   * const redemption = await clikgate.codes.redeem({ externalId: 'POS-991', code: 'ADA42', channel: 'pos' });
   * if (redemption.referral) console.log(redemption.referral.id);
   */
  async redeem(params: CodeRedeemParams, requestOptions: RequestOptions = {}): Promise<CodeRedemption> {
    const body = defined({
      external_id: params.externalId,
      code: params.code,
      channel: params.channel,
      app_id: params.appId,
      occurred_at: params.occurredAt === undefined || params.occurredAt === null ? undefined : formatDate(params.occurredAt),
      metadata: params.metadata ?? undefined,
      subject: params.subject ?? undefined,
      agent_id: params.agentId ?? undefined,
      location: params.location ?? undefined,
    });
    const { data } = await this.core.requester.request<CodeRedemption>({ method: 'POST', path: '/v1/codes/redeem', body, ...requestOptions });
    return data && data.referral ? { ...data, referral: toReferral(data.referral) } : data;
  }
}
