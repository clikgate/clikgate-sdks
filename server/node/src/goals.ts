import type { GuardState } from './config.js';
import type { Core } from './core.js';
import { ClikgateError, InvalidRequestError, errorFromBatchItem, localError } from './errors.js';
import { guardPayload } from './guard.js';
import { formatDate, isRetryable, type RequestOptions } from './http.js';
import type { Provider } from './enums.js';
import { BROWSER_ENGINES, KEPT_BY, PLATFORMS, type BrowserEngine, type KeptBy, type Platform } from './click-ids.js';
import { formatValue, type MoneyInput } from './money.js';
import { checkHashedFields } from './ads-hashing.js';
import type { GoalBatchResult, GoalEvent } from './types.js';

/** Options for a goal event. Only `reference` is required. */
export interface GoalOptions {
  /** Your own unique ID for this event (application number, order ID, transaction reference), 1–128 characters. */
  reference: string;
  /** The Clikgate click ID you kept (`clk_…`), e.g. from `clickIds.fromRequest(req)`. */
  clickId?: string | null;
  /** An offline or creator code, instead of a click ID. */
  code?: string | null;
  /** The value in normal units (₦2,000,000 is `'2000000'`). Prefer a decimal string. */
  value?: MoneyInput | null;
  /** ISO 4217; defaults to the goal's default currency. */
  currency?: string | null;
  /**
   * The payment provider of a Payment goal, e.g. `Provider.Paystack` (with `reference` = the payment reference).
   * A provider key string works too, for a gateway added after this SDK release; the API checks it.
   */
  provider?: Provider | (string & {}) | null;
  /** Your statement that this is the customer's first such event (from your server, this is what counts a new customer). */
  isFirst?: boolean | null;
  /**
   * The person's label your team sees instead of the click ID (1–80 characters, `''` clears it; Growth and up).
   * In private mode only when the organisation allows labels there. Don't put information in labels that your
   * customers wouldn't expect you to keep.
   */
  label?: string | null;
  /** How the click ID was kept (`clickIds.context(req)` sets it). Allowed in private mode. */
  keptBy?: KeptBy | null;
  /** The visitor's browser engine (`clickIds.context(req)` sets it). Allowed in private mode. */
  browserEngine?: BrowserEngine | null;
  /** The visitor's platform (`clickIds.context(req)` sets it). Allowed in private mode. */
  platform?: Platform | null;
  /**
   * Ad network matching: your own SHA-256 of the customer's email, trimmed and lowercased, as 64
   * lowercase hex characters. Make it with `hashForAds({ email })`. Used only when the business turned on matching
   * by hashed email or phone for a destination. In private mode, hash on your own server: Clikgate never hashes
   * for you there.
   */
  hashedEmail?: string | null;
  /** SHA-256 of the phone in E.164 with the `+` (`hashForAds({ phone })`). See `hashedEmail`. */
  hashedPhoneE164?: string | null;
  /** SHA-256 of the phone digits with the country code, no `+` (`hashForAds({ phone })`). See `hashedEmail`. */
  hashedPhoneDigits?: string | null;
  /** When it happened (defaults to now on the server). */
  occurredAt?: Date | string | null;
  /** Up to 8 KB of your own data. Refused in private mode. */
  metadata?: Record<string, unknown> | null;
  /** Consent signals (`analytics`, `attribution`, `ad_user_data`, `ad_personalization`). Allowed in private mode. */
  consent?: Record<string, unknown> | null;
  /** Extra wire fields, sent as is (forward compatibility). Checked by the private-mode guard. */
  extra?: Record<string, unknown>;
}

/** One event of `goals.sendBatch`: the goal key plus its options. */
export interface GoalBatchEvent extends GoalOptions {
  goal: string;
}

/** Options for `goals.reverse`. */
export interface ReverseOptions {
  /** A partial reversal amount; omit for a full reversal. */
  value?: MoneyInput | null;
  /** Why (free text). Refused in private mode. */
  reason?: string | null;
}

const GOAL_KEY = /^[a-z][a-z0-9_]{1,39}$/;
const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,29}$/;
/** @internal A goal event as it goes on the wire. */
export type GoalWire = Record<string, unknown> & { goal: string; reference: string };

const compact = (o: Record<string, unknown>) => {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
};

function checkKey(key: unknown): string {
  if (typeof key !== 'string' || !GOAL_KEY.test(key)) {
    throw localError('invalid_goal_key', 'Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. "account_opened").', 'goal');
  }
  return key;
}

function checkReference(reference: unknown): string {
  if (typeof reference !== 'string' || reference.length < 1 || reference.length > 128) {
    throw localError('invalid_reference', 'reference is required: your own unique ID for this event, 1-128 characters.', 'reference');
  }
  return reference;
}

function checkEnum(field: string, value: unknown, allowed: readonly string[]): void {
  if (value == null) return;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw localError('invalid_argument', `${field} must be one of ${allowed.join(', ')}.`, field);
  }
}

/** @internal Validate goal options and build the wire object (SPEC 9.1 step 1). */
export function buildGoalWire(core: Core, key: unknown, options: GoalOptions | undefined): GoalWire {
  const goal = checkKey(key);
  const o = (options ?? {}) as GoalOptions;
  const reference = checkReference(o.reference);
  if (o.clickId != null && o.code != null) throw localError('click_id_and_code', 'Send either clickId or code, not both.', 'code');
  if (o.provider != null && (typeof o.provider !== 'string' || !PROVIDER_KEY.test(o.provider))) {
    throw localError('invalid_provider', 'provider must be a provider key such as "paystack" or "stripe" (lower case; see Provider).', 'provider');
  }
  checkEnum('kept_by', o.keptBy, KEPT_BY);
  checkEnum('browser_engine', o.browserEngine, BROWSER_ENGINES);
  checkEnum('platform', o.platform, PLATFORMS);
  const wire: Record<string, unknown> = {
    goal,
    reference,
    click_id: o.clickId,
    code: o.code,
    value: o.value === undefined || o.value === null ? undefined : formatValue(o.value, (m) => core.warn('inexact_number', m)),
    currency: o.currency,
    provider: o.provider,
    is_first: o.isFirst,
    label: o.label,
    kept_by: o.keptBy,
    browser_engine: o.browserEngine,
    platform: o.platform,
    hashed_email: o.hashedEmail,
    hashed_phone_e164: o.hashedPhoneE164,
    hashed_phone_digits: o.hashedPhoneDigits,
    occurred_at: o.occurredAt == null ? undefined : formatDate(o.occurredAt),
    metadata: o.metadata,
    consent: o.consent,
    ...(o.extra ?? {}),
  };
  checkHashedFields(wire);
  return compact(wire) as GoalWire;
}

/** @internal Config-based warnings (SPEC 12.3); warn-only. */
export function goalWarnings(core: Core, state: GuardState, wire: GoalWire): void {
  if (!state.config || core.privateMode !== 'auto') return;
  const goal = state.config.goals?.find((g) => g.key === wire.goal);
  if (!goal) {
    core.warn('unknown_goal', `The goal "${wire.goal}" isn't defined for your organisation (it will be sent; the API decides).`, wire.goal);
    return;
  }
  if (goal.value_mode === 'none' && wire.value !== undefined) core.warn('value_not_allowed', `The goal "${wire.goal}" takes no value.`, wire.goal);
  if (goal.value_mode === 'required' && wire.value === undefined) core.warn('value_required', `The goal "${wire.goal}" needs a value.`, wire.goal);
}

/** @internal Steps 2 and 3 of SPEC 9.1 for one wire event. Throws PrivateModeFieldRejectedError. */
export function checkBeforeSend(core: Core, state: GuardState, wire: GoalWire): void {
  goalWarnings(core, state, wire);
  if (state.guard) guardPayload('goal', wire);
}

interface Queued {
  wire: GoalWire;
  rounds: number;
}

/** @internal Settings of the background sender. */
export interface QueueSettings {
  batchSize: number;
  flushIntervalMs: number;
  maxQueueSize: number;
}

const MAX_FAILED_ROUNDS = 3;

/** @internal The background queue (SPEC 9.3): one batch in flight at a time, in queue order. */
export class GoalQueue {
  private items: Queued[] = [];
  private chain: Promise<void> = Promise.resolve();
  private sizeJobPending = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingSync = new Set<Promise<unknown>>();

  constructor(
    private readonly core: Core,
    private readonly settings: QueueSettings,
  ) {}

  get size(): number {
    return this.items.length;
  }

  /** Whether anything is queued or in flight. */
  get busy(): boolean {
    return this.items.length > 0 || this.pendingSync.size > 0;
  }

  enqueue(wire: GoalWire): void {
    if (this.items.length >= this.settings.maxQueueSize) {
      const dropped = this.items.shift();
      if (dropped) {
        this.core.warn('queue_full_dropped', `The Clikgate queue is full (${this.settings.maxQueueSize} events); the oldest event was dropped.`);
        this.core.report(localError('queue_full', 'The background queue was full; this event was dropped.'), { operation: 'goal', events: [this.shown(dropped.wire)], dropped: true });
      }
    }
    this.items.push({ wire, rounds: 0 });
    this.startTimer();
    if (this.items.length >= this.settings.batchSize && !this.sizeJobPending) {
      this.sizeJobPending = true;
      this.schedule(async () => {
        this.sizeJobPending = false;
        while (this.items.length >= this.settings.batchSize) {
          const requeue = await this.sendBatch(this.items.splice(0, this.settings.batchSize));
          this.items.unshift(...requeue);
          if (requeue.length) break;
        }
      });
    }
  }

  /** Hold on to a sync-mode send so flush() waits for it. */
  holdSend(p: Promise<unknown>): void {
    this.pendingSync.add(p);
    void p.finally(() => this.pendingSync.delete(p));
  }

  /** Send everything queued now (and wait for in-flight sends). Resolves true when done before the timeout. Never rejects. */
  flush(timeoutMs: number): Promise<boolean> {
    const work = this.schedule(() => this.drainOnce()).then(() => Promise.allSettled([...this.pendingSync]));
    return withTimeout(work, timeoutMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private startTimer(): void {
    if (this.timer || this.settings.flushIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      if (this.items.length) void this.schedule(() => this.drainOnce());
    }, this.settings.flushIntervalMs);
    this.timer.unref?.();
  }

  private schedule(job: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(job).catch(() => undefined);
    return this.chain;
  }

  /** Attempt every event queued at this moment once; failed retryable ones go back to the front. */
  private async drainOnce(): Promise<void> {
    let remaining = this.items.length;
    const requeue: Queued[] = [];
    while (remaining > 0 && this.items.length > 0) {
      const batch = this.items.splice(0, Math.min(this.settings.batchSize, remaining));
      remaining -= batch.length;
      requeue.push(...(await this.sendBatch(batch)));
    }
    this.items.unshift(...requeue);
  }

  private shown(wire: GoalWire): { goal: string; reference: string } {
    return { goal: wire.goal, reference: this.core.shownReference(wire.reference) };
  }

  /** Send one batch. Returns the events to re-queue. */
  private async sendBatch(batch: Queued[]): Promise<Queued[]> {
    let state: GuardState;
    try {
      state = await this.core.guardState();
    } catch {
      state = { guard: true, config: null };
    }
    const sendable: Queued[] = [];
    for (const q of batch) {
      try {
        checkBeforeSend(this.core, state, q.wire);
        sendable.push(q);
      } catch (err) {
        this.core.report(asClikgateError(err), { operation: 'goal', events: [this.shown(q.wire)], dropped: true });
      }
    }
    if (sendable.length === 0) return [];
    try {
      const { data } = await this.core.requester.request<GoalBatchResult>({
        method: 'POST',
        path: '/v1/goals/events/batch',
        body: { events: sendable.map((q) => q.wire) },
      });
      for (const item of data?.data ?? []) {
        const q = sendable[item.index];
        if (!q) continue;
        if (item.ok) {
          this.core.noteRefusedGoal(q.wire.goal, item.goal_event?.reason);
          continue;
        }
        const error = errorFromBatchItem(item.status, item.error);
        this.core.noteRefusedGoal(q.wire.goal, error.code);
        this.core.report(error, { operation: 'goal', events: [this.shown(q.wire)], dropped: true });
      }
      return [];
    } catch (err) {
      const error = asClikgateError(err);
      for (const q of sendable) this.core.noteRefusedGoal(q.wire.goal, error.code);
      if (isRetryable(error)) {
        const keep: Queued[] = [];
        const drop: Queued[] = [];
        for (const q of sendable) {
          q.rounds += 1;
          (q.rounds >= MAX_FAILED_ROUNDS ? drop : keep).push(q);
        }
        if (drop.length) this.core.report(error, { operation: 'goals.batch', events: drop.map((q) => this.shown(q.wire)), dropped: true });
        return keep;
      }
      this.core.report(error, { operation: 'goals.batch', events: sendable.map((q) => this.shown(q.wire)), dropped: true });
      return [];
    }
  }
}

/** @internal */
export function asClikgateError(err: unknown): ClikgateError {
  if (err instanceof ClikgateError) return err;
  return new ClikgateError({ message: err instanceof Error ? err.message : String(err), code: 'unexpected_error' });
}

/** @internal Resolve true if `p` settles within `ms`, false otherwise. Never rejects. */
export function withTimeout(p: Promise<unknown>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    t.unref?.();
    p.then(
      () => {
        clearTimeout(t);
        resolve(true);
      },
      () => {
        clearTimeout(t);
        resolve(true);
      },
    );
  });
}

/**
 * Goal events: the outcomes your business cares about (`account_opened`, `loan_disbursed`, `order_paid`).
 * `goals.send` waits for the API and throws on failure; `clikgate.goal()` is the fire-and-forget version.
 */
export class Goals {
  /** @internal */
  constructor(private readonly core: Core) {}

  /**
   * Send one goal event and wait for the result. Each call sends a random `Idempotency-Key`, reused
   * across that call's retries; the API itself ignores a second event with the same goal and
   * reference, so a resend never counts twice.
   *
   * @returns the goal event: `status` (`GoalStatus`: counted, waiting or refused), `reason`, `goal_kind`,
   * `attributed_to`, `first_for_click`, … `waiting` and `refused` are results, not errors.
   * @throws {InvalidRequestError} local validation or a 4xx; {@link PrivateModeFieldRejectedError} in private mode.
   * @example
   * const event = await clikgate.goals.send('account_opened', {
   *   clickId: application.clickId,   // kept since the visitor landed
   *   reference: 'APP-55231',
   *   value: '2000000',               // ₦2,000,000 in normal units, as a string
   *   currency: 'NGN',
   * });
   * if (event.status === GoalStatus.Counted) console.log('attributed to', event.attributed_to?.link_id);
   *
   * // A Payment goal, right after your server verified the payment with the gateway:
   * await clikgate.goals.send('order_paid', { reference: 'T123456', provider: Provider.Paystack, value: '7500', currency: 'NGN', clickId });
   */
  async send(key: string, options: GoalOptions, requestOptions: RequestOptions = {}): Promise<GoalEvent> {
    const wire = buildGoalWire(this.core, key, options);
    return this.sendWire(wire, requestOptions);
  }

  /** @internal */
  async sendWire(wire: GoalWire, requestOptions: RequestOptions = {}): Promise<GoalEvent> {
    const state = await this.core.guardState();
    checkBeforeSend(this.core, state, wire);
    let data: GoalEvent;
    try {
      ({ data } = await this.core.requester.request<GoalEvent>({
        method: 'POST',
        path: '/v1/goals/events',
        body: wire,
        ...requestOptions,
      }));
    } catch (err) {
      if (err instanceof ClikgateError) this.core.noteRefusedGoal(wire.goal, err.code);
      throw err;
    }
    this.core.noteRefusedGoal(wire.goal, data?.reason);
    return data;
  }

  /**
   * Send up to 500 goal events in one request. Per-event failures are returned, not thrown.
   *
   * @throws {InvalidRequestError} when an event fails local validation (with `index`), or the batch is empty or too large.
   * @example
   * const result = await clikgate.goals.sendBatch([
   *   { goal: 'order_paid', reference: 'ORD-1001', clickId, value: '1500.50', currency: 'NGN' },
   *   { goal: 'order_paid', reference: 'ORD-1002', value: '99.90' },
   * ]);
   * for (const item of result.data) if (!item.ok) console.warn(item.index, item.error?.code);
   */
  async sendBatch(events: GoalBatchEvent[], requestOptions: RequestOptions = {}): Promise<GoalBatchResult> {
    if (!Array.isArray(events) || events.length === 0) throw localError('batch_empty', 'Send at least one event.', 'events');
    if (events.length > 500) throw localError('batch_too_large', 'A batch takes at most 500 events.', 'events');
    const wires = events.map((e, i) => withIndex(i, () => buildGoalWire(this.core, e?.goal, e)));
    const state = await this.core.guardState();
    wires.forEach((w, i) => withIndex(i, () => checkBeforeSend(this.core, state, w)));
    const { data } = await this.core.requester.request<GoalBatchResult>({ method: 'POST', path: '/v1/goals/events/batch', body: { events: wires }, ...requestOptions });
    for (const item of data?.data ?? []) {
      this.core.noteRefusedGoal(wires[item.index]?.goal, item.ok ? item.goal_event?.reason : (item.error as { code?: unknown } | null)?.code);
    }
    return data;
  }

  /**
   * Reverse a goal event, fully (no value) or partly (a refund, a cancelled loan, a chargeback).
   * The completion still counts; reported value drops by the reversed amount.
   *
   * @example
   * await clikgate.goals.reverse('loan_disbursed', 'LN-2201');                     // full
   * await clikgate.goals.reverse('order_paid', 'ORD-1001', { value: '500' });      // partial
   */
  async reverse(key: string, reference: string, options: ReverseOptions = {}, requestOptions: RequestOptions = {}): Promise<GoalEvent> {
    const goal = checkKey(key);
    const ref = checkReference(reference);
    const wire = compact({
      goal,
      reference: ref,
      value: options.value == null ? undefined : formatValue(options.value, (m) => this.core.warn('inexact_number', m)),
      reason: options.reason,
    });
    const state = await this.core.guardState();
    if (state.guard) guardPayload('reversal', wire);
    const { data } = await this.core.requester.request<GoalEvent>({ method: 'POST', path: '/v1/goals/events/reverse', body: wire, ...requestOptions });
    return data;
  }
}

function withIndex<T>(index: number, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof InvalidRequestError) err.index = index;
    throw err;
  }
}
