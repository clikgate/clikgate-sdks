import type { GoalKind, GoalStatus, Provider } from './enums.js';

/** Wire objects returned by the hand-written resources. Keys are as the API sends them (snake_case). */

/** Where a goal event was attributed. */
export interface GoalAttribution {
  link_id: string | null;
  campaign_id: string | null;
  clicked_at: string | null;
}

/** A goal event (`POST /v1/goals/events`). */
export interface GoalEvent {
  object: 'goal_event';
  /** `cnv_…`; a Payment goal waiting for its report has its confirmation id (`pcf_…`). */
  id: string;
  /** The outcome: `counted`, `waiting` (a Payment goal waiting for its confirmation) or `refused`. Compare with `GoalStatus`. */
  status: GoalStatus;
  /** `null` when counted; else why, e.g. `waiting_for_confirmation`, `already_counted_for_click`, `rejected_bot`. */
  reason: string | null;
  /** The goal's kind (set in the goal's settings): `standard` or `payment`. */
  goal_kind?: GoalKind;
  /** Whether this event counts in totals: `status === 'counted'`. */
  counted: boolean;
  /** `true` when a value was dropped (browsers and apps can't set a Payment goal's value). */
  value_ignored?: boolean;
  /** The event's attribution state: `attributed`, `unattributed`, `rejected_bot`, … (`null` while a Payment goal waits). */
  event_status?: string | null;
  goal: string;
  /** Your reference; `null` in private mode. */
  reference: string | null;
  /** Normal units as a decimal string, e.g. `"2000000"`. Never a float. */
  value: string | null;
  /**
   * The same amount in the currency's minor units (kobo, cents), e.g. `200000000`. `null` without a value.
   * Prefer `value` for exact amounts: minor units above 2^53 lose precision as a JS number.
   */
  value_minor?: number | null;
  currency: string | null;
  reversed_value?: string | null;
  /** `reversed_value` in minor units; `null` when nothing was reversed. */
  reversed_value_minor?: number | null;
  first_for_click: boolean | null;
  is_first: boolean | null;
  unattributed_reason?: string | null;
  duplicate_of_id?: string | null;
  attributed_to: GoalAttribution | null;
  /** A Payment goal sent by your server: the confirmation it became. `null` otherwise. */
  payment?: GoalPayment | null;
  occurred_at: string;
  received_at: string;
  livemode: boolean;
  [key: string]: unknown;
}

/** The confirmation a Payment goal sent by your server became. */
export interface GoalPayment {
  /** `pcf_…` */
  confirmation_id: string;
  /** `matched`, `waiting_for_report`, `counted_without_report`, `duplicate`, … (new values can appear). */
  match_status: string;
  /** The browser's or app's report it matched (`prp_…`), or `null`. */
  report_id: string | null;
  /** The provider (a `Provider` value, or a newer gateway's key). */
  provider: Provider | (string & {});
  [key: string]: unknown;
}

/** One item of a batch result. */
export interface GoalBatchItem {
  index: number;
  ok: boolean;
  status: number;
  goal_event?: GoalEvent | null;
  error?: { type?: string; code?: string; message?: string; param?: string | null; [key: string]: unknown } | null;
}

/** `POST /v1/goals/events/batch` result: one item per event, in order. */
export interface GoalBatchResult {
  object: 'list';
  data: GoalBatchItem[];
}

/** A non-blocking finding on a link, e.g. `no_preview`. */
export interface LinkWarning {
  code: string;
  message: string;
  param?: string | null;
}

/** A link (`/v1/links`). Only the most used fields are typed; the rest are kept. */
export interface Link {
  object: 'link';
  id: string;
  short_url: string;
  domain: string;
  slug: string;
  status: string;
  destination_url: string;
  fallback_url: string | null;
  title: string | null;
  og_title: string | null;
  og_image_url: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  /** Non-blocking warnings, e.g. `no_preview`. */
  warnings: LinkWarning[];
  /** `"premium"` on `ciz.to` links, else `null`. */
  domain_badge?: 'premium' | null;
  /** True when destination, fallback and deep-link changes are refused (`409 link_locked`). */
  locked?: boolean;
  created_at: string;
  updated_at: string;
  livemode: boolean;
  [key: string]: unknown;
}

/** A pending destination change awaiting a second person's approval (`202` on update). */
export interface LinkChangeRequest {
  object: 'link_change_request';
  id: string;
  link_id: string;
  requested_by: string;
  /** Who asked for the change: `user`, `key`, `client` or `cli` (a plain string; new values can appear). */
  requested_by_type: string;
  from_url: string;
  to_url: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decided_by: string | null;
  decided_at: string | null;
  /** The approver's or rejecter's note, once decided. */
  decision_note: string | null;
  created_at: string;
  expires_at: string;
  /** `true` for live-environment data, `false` for test mode. */
  livemode: boolean;
  [key: string]: unknown;
}

/** The result of `links.update`: applied now, or waiting for approval. */
export type LinkUpdateResult =
  | { applied: true; link: Link; change_request: null; warnings: LinkWarning[] }
  | { applied: false; link: null; change_request: LinkChangeRequest; warnings: LinkWarning[] };

/** A click (`/v1/clicks/{id}`). */
export interface Click {
  object: 'click';
  id: string;
  occurred_at: string;
  link: { id: string; [key: string]: unknown } | null;
  campaign: { id: string; [key: string]: unknown } | null;
  country?: string | null;
  device_type?: string | null;
  is_suspected_bot: boolean;
  livemode: boolean;
  [key: string]: unknown;
}

/** A conversion (older API). */
export interface Conversion {
  object: 'conversion';
  id: string;
  status?: string;
  [key: string]: unknown;
}

/** One page of a list. */
export interface ListPage<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** A goal as `GET /v1/server-sdk/config` describes it. */
export interface ConfigGoal {
  key: string;
  value_mode: 'none' | 'optional' | 'required';
  default_currency: string | null;
}

/** `GET /v1/server-sdk/config`. */
export interface ServerSdkConfig {
  mode: 'live' | 'test';
  organization_id: string;
  private_mode: boolean;
  click_id_param: string;
  goals: ConfigGoal[];
  minimum_sdk_versions: Partial<Record<'node' | 'python' | 'php' | 'java' | 'dotnet', string>>;
  [key: string]: unknown;
}

/** A webhook event. */
export interface WebhookEvent<T = Record<string, unknown>> {
  id: string;
  object: 'event';
  /** e.g. `goal.completed`, `link.destination_changed`, `subscription.updated`. */
  type: string;
  api_version: string;
  created_at: string;
  organization_id: string;
  livemode: boolean;
  data: { object: T; previous_attributes?: Record<string, unknown> | null; [key: string]: unknown };
  [key: string]: unknown;
}

/** QR code bytes. */
export interface QrCode {
  contentType: string;
  data: Uint8Array;
}
