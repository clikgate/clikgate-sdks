import type { Core } from './core.js';
import { guardPayload } from './guard.js';
import { encodePathSegment, requireId, type RequestOptions } from './http.js';
import { formatValue } from './money.js';
import { checkHashedFields } from './ads-hashing.js';
import type { Click, Conversion, GoalEvent, Link, LinkChangeRequest, LinkUpdateResult, ListPage, QrCode } from './types.js';

type Params = Record<string, unknown>;

function withFormattedValue(core: Core, params: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) out[k] = v;
  if (out.value !== undefined && out.value !== null) out.value = formatValue(out.value as string | number | bigint, (m) => core.warn('inexact_number', m));
  return out;
}

/** Conversions: the older API. New integrations should use goals. */
export class Conversions {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Report a conversion (`POST /v1/conversions`). `params` uses the API's field names.
   * In private mode only `external_id`, `goal`, `click_id`, `code`, `reference`, `value`, `currency`,
   * `provider`, `is_first`, `occurred_at`, `consent`, `kept_by`, `browser_engine`, `platform` and the hashed
   * identifiers `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` (64 lowercase hex; `hashForAds`) are allowed.
   *
   * With `goal` set to a Payment goal this is a trusted payment confirmation: send `provider` and the payment
   * reference (`external_id`), and the answer is the goal event (`object: 'goal_event'`) instead of a conversion.
   * Tell them apart by `object`.
   *
   * @example
   * await clikgate.conversions.create({ external_id: 'ORD-1001', click_id: clickId, goal: 'order_paid', value: '1500.50', currency: 'NGN' });
   */
  async create(params: Params, requestOptions: RequestOptions = {}): Promise<Conversion | GoalEvent> {
    const body = withFormattedValue(this.core, params);
    checkHashedFields(body);
    const state = await this.core.guardState();
    if (state.guard) guardPayload('conversion', body);
    const { data } = await this.core.requester.request<Conversion | GoalEvent>({ method: 'POST', path: '/v1/conversions', body, ...requestOptions });
    return data;
  }

  /**
   * Reverse a conversion, fully or partly (`amount_minor`).
   *
   * @example
   * await clikgate.conversions.reverse('cnv_01J…', { amount_minor: 200000, reason: 'partial refund' });
   */
  async reverse(id: string, params: Params = {}, requestOptions: RequestOptions = {}): Promise<Conversion> {
    const body = withFormattedValue(this.core, params);
    const state = await this.core.guardState();
    if (state.guard) guardPayload('reversal', body);
    const { data } = await this.core.requester.request<Conversion>({ method: 'POST', path: `/v1/conversions/${encodePathSegment(requireId(id))}/reverse`, body, ...requestOptions });
    return data;
  }
}

/** Options for `links.qr`. */
export interface QrOptions {
  format?: 'svg' | 'png';
  /** 256–2048 pixels. */
  size?: number;
  margin?: number;
  /** Hex colour without `#`, e.g. `000000`. */
  dark?: string;
  light?: string;
}

/** An async iterator over every link that also exposes the first page. */
export interface LinkIterator extends AsyncIterable<Link> {
  /** Collect up to `max` links (default: all). */
  toArray(max?: number): Promise<Link[]>;
}

/** Links: create, read, update (with approvals and locks), list and QR codes. */
export class Links {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Create a link. The result's `warnings` include `no_preview` when there is no preview title and image.
   *
   * @example
   * const link = await clikgate.links.create({ destination_url: 'https://example.com/spring', og_title: 'Spring sale', og_image_url: 'https://example.com/og.png' });
   * console.log(link.short_url, link.warnings);
   */
  async create(params: Params, requestOptions: RequestOptions = {}): Promise<Link> {
    const { data } = await this.core.requester.request<Link>({ method: 'POST', path: '/v1/links', body: params, ...requestOptions });
    return data;
  }

  /**
   * Fetch a link by ID.
   *
   * @example
   * const link = await clikgate.links.get('lnk_01J…');
   */
  async get(id: string, requestOptions: RequestOptions = {}): Promise<Link> {
    const { data } = await this.core.requester.request<Link>({ method: 'GET', path: `/v1/links/${encodePathSegment(requireId(id))}`, ...requestOptions });
    return data;
  }

  /**
   * Update a link. With two-person approval on, a destination change answers `202` and waits for a
   * second person: the result is `{ applied: false, change_request }`. A locked link throws {@link LinkLockedError}.
   * An explicit `null` clears a field.
   *
   * @example
   * const result = await clikgate.links.update('lnk_01J…', { destination_url: 'https://example.com/summer' });
   * if (!result.applied) console.log('waiting for approval:', result.change_request.id);
   */
  async update(id: string, params: Params, requestOptions: RequestOptions = {}): Promise<LinkUpdateResult> {
    const { status, data } = await this.core.requester.request<Link | LinkChangeRequest>({
      method: 'PATCH',
      path: `/v1/links/${encodePathSegment(requireId(id))}`,
      body: params,
      ...requestOptions,
    });
    if (status === 202) return { applied: false, link: null, change_request: data as LinkChangeRequest, warnings: [] };
    const link = data as Link;
    return { applied: true, link, change_request: null, warnings: Array.isArray(link?.warnings) ? link.warnings : [] };
  }

  /**
   * Fetch one page of links (`limit` 1–100, `starting_after`, `ending_before`, filters such as `status`, `tag`, `campaign_id`).
   *
   * @example
   * const page = await clikgate.links.listPage({ limit: 100, tag: 'promo' });
   */
  async listPage(params: Params = {}, requestOptions: RequestOptions = {}): Promise<ListPage<Link>> {
    const { data } = await this.core.requester.request<ListPage<Link>>({ method: 'GET', path: '/v1/links', query: params, ...requestOptions });
    return data;
  }

  /**
   * Iterate over every link, fetching pages lazily.
   *
   * @example
   * for await (const link of clikgate.links.list({ status: 'active', limit: 100 })) {
   *   console.log(link.short_url);
   * }
   */
  list(params: Params = {}, requestOptions: RequestOptions = {}): LinkIterator {
    const listPage = (p: Params) => this.listPage(p, requestOptions);
    async function* iterate(): AsyncGenerator<Link> {
      let cursor: string | null = null;
      for (;;) {
        const page: ListPage<Link> = await listPage(cursor ? { ...params, starting_after: cursor } : params);
        for (const item of page.data ?? []) yield item;
        if (!page.has_more || !page.next_cursor) return;
        cursor = page.next_cursor;
      }
    }
    return {
      [Symbol.asyncIterator]: iterate,
      async toArray(max = Number.POSITIVE_INFINITY) {
        const out: Link[] = [];
        if (max <= 0) return out;
        for await (const l of iterate()) {
          out.push(l);
          if (out.length >= max) break;
        }
        return out;
      },
    };
  }

  /**
   * Download the link's QR code.
   *
   * @example
   * const qr = await clikgate.links.qr('lnk_01J…', { format: 'png', size: 1024 });
   * await fs.promises.writeFile('qr.png', qr.data);
   */
  async qr(id: string, options: QrOptions = {}, requestOptions: RequestOptions = {}): Promise<QrCode> {
    const res = await this.core.requester.send({ method: 'GET', path: `/v1/links/${encodePathSegment(requireId(id))}/qr`, query: { ...options }, raw: true, ...requestOptions });
    return { contentType: res.headers['content-type'] ?? 'application/octet-stream', data: res.body };
  }
}

/** Clicks. */
export class Clicks {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Fetch a click by its ID (`clk_…`).
   *
   * @example
   * const click = await clikgate.clicks.get(clickId);
   * console.log(click.country, click.link?.id);
   */
  async get(clickId: string, requestOptions: RequestOptions = {}): Promise<Click> {
    const { data } = await this.core.requester.request<Click>({ method: 'GET', path: `/v1/clicks/${encodePathSegment(requireId(clickId, 'click_id'))}`, ...requestOptions });
    return data;
  }
}
