import type * as Gen from './generated/index.js';
import type { ListPage } from './types.js';

/**
 * Typed models of the referrals, privacy, people, installs and codes resources (SPEC sections 28-32).
 * Keys are as the API sends them (snake_case); unknown keys are kept. `amount` (on reward sides) and `created`
 * (on `getOrCreateReferrer`) are added by the SDK.
 */

/** A referrer's counters, refreshed regularly (not live). */
export interface ReferrerStats {
  /** Human clicks on the referrer's link. */
  clicks: number;
  /** Referrals of any status. */
  installs: number;
  /** Referrals past their first qualification step (rejected ones excluded). */
  signups: number;
  /** Open referrals. */
  in_progress: number;
  qualified: number;
  disqualified: number;
  rejected: number;
  /** Share of referees (0 to 1) who uninstalled within 7 days; `null` when none is old enough yet. Absent until first refreshed. */
  referee_uninstall_rate_7d?: number | null;
  [key: string]: unknown;
}

/** A customer who refers others in a referral program. */
export interface Referrer {
  object: 'referrer';
  /** `rfr_…` */
  id: string;
  program_id: string;
  /** Your customer ID (the `customerId` you passed), as the API names it. */
  customer_user_id: string;
  /** The same customer ID (added by the SDK). */
  customerId: string;
  display_name: string | null;
  /** The referral code. */
  code: string;
  external_code: string | null;
  link_id: string | null;
  /** The code URL, else the short link. */
  url: string | null;
  short_url: string | null;
  /** `active` or `blocked` (a plain string: new values can appear). */
  status: 'active' | 'blocked' | (string & {});
  blocked_reason: string | null;
  blocked_at: string | null;
  stats: ReferrerStats;
  /** Your own free-form data about the referrer. */
  attributes: Record<string, unknown>;
  leaderboard_opt_out: boolean;
  quality_score: number | null;
  /** `good`, `watch` or `poor`; `null` until scored. */
  quality_band: string | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
  livemode: boolean;
  [key: string]: unknown;
}

/** A referrer from `getOrCreateReferrer`: `created` is true when it was just created (the API answered 201). */
export interface ReferrerResult extends Referrer {
  created: boolean;
}

/** One side's reward. Keys without a value are absent. */
export interface RewardSide {
  /** The amount in the currency's minor units (kobo, cents), as the API sends it. */
  amount_minor?: number;
  /** ISO 4217 code, present with `amount_minor`. */
  currency?: string;
  /** The same amount in normal units as a decimal string with the currency's exponent (`"500.00"`). Added by the SDK. */
  amount?: string;
  /** The reward in words. */
  description?: string;
  [key: string]: unknown;
}

/** Reward information, for your records: Clikgate never pays rewards. */
export interface RewardInfo {
  /** What the referrer gets. */
  referrer?: RewardSide;
  /** What the referee gets. */
  referee?: RewardSide;
  note?: string;
  [key: string]: unknown;
}

/** A qualification step the referee completed. */
export interface ReferralStep {
  /** The step's position in the program's steps (0 is the first). */
  index: number;
  /** The step's goal key; absent for identify steps. */
  goal?: string;
  /** `true` for an identify step; absent for goal steps. */
  identify?: boolean;
  completed_at: string;
  source_id?: string | null;
  [key: string]: unknown;
}

/** A referral: an install matched to a referrer, and its progress through the program's steps. */
export interface Referral {
  object: 'referral';
  /** `ref_…` */
  id: string;
  program_id: string;
  referrer_id: string;
  /** `installed`, `in_progress`, `holding`, `qualified`, `disqualified`, `rejected`, … (a plain string). */
  status: string;
  source: string;
  match_type: string | null;
  current_step: number;
  steps_completed: ReferralStep[];
  step_deadline_at: string | null;
  hold_until: string | null;
  qualified_at: string | null;
  disqualified_at: string | null;
  rejected_at: string | null;
  reason: string | null;
  reason_detail?: string | null;
  reason_message?: string | null;
  fraud_flags: string[];
  referee_uninstalled_after_qualification: boolean;
  program: { id: string; name: string; [key: string]: unknown };
  /** The referrer; `customerId` (added by the SDK) equals `customer_user_id`. */
  referrer: { id: string; customer_user_id: string; customerId: string; code: string; [key: string]: unknown };
  /** The referee; `customerId` (added by the SDK) equals `customer_user_id` (`null` until identified). */
  referee: { install_id: string; installation_id: string; customer_user_id: string | null; customerId: string | null; [key: string]: unknown };
  link: { id: string; [key: string]: unknown } | null;
  click_id: string | null;
  /** The program's reward when the referral qualified; absent when there was none. */
  reward_snapshot?: RewardInfo | null;
  /** The referral's status changes, when the API includes them. */
  history?: ReferralStateChange[] | null;
  created_at: string;
  updated_at: string;
  livemode: boolean;
  [key: string]: unknown;
}

/** One status change of a referral. */
export interface ReferralStateChange {
  from_status: string | null;
  to_status: string;
  reason: string | null;
  actor: string;
  created_at: string;
  [key: string]: unknown;
}

/** One result of a job (only the keys that apply are present). */
export interface JobResult {
  index?: number;
  ok?: boolean;
  referrer_id?: string;
  link_id?: string;
  created?: boolean;
  /** Exports and downloads: a signed link to the file and when it stops working (Unix seconds). */
  url?: string;
  expires_at?: number;
  rows?: number;
  files?: number;
  run_id?: string;
  /** Test data resets: the kind of data deleted and how many rows. */
  table?: string;
  deleted?: number;
  error?: { type: string; code: string; message?: string; param?: string | null; [key: string]: unknown };
  [key: string]: unknown;
}

/** A background job, e.g. a referrer import. */
export interface Job {
  object: 'job';
  id: string;
  type: string;
  status: string;
  total: number;
  succeeded: number;
  failed: number;
  results: JobResult[];
  created_at: string;
  finished_at: string | null;
  livemode: boolean;
  [key: string]: unknown;
}

/** A privacy request (access, export, delete or erasure). */
export interface PrivacyRequest {
  object: 'privacy_request';
  id: string;
  app_id: string | null;
  type: string;
  subject_type: string;
  /** `pending`, `running`, `completed` or `failed`. */
  status: string;
  /** Set once completed: an export's `{download_url, expires_at, installs, goal_name_events}`, or an erasure's counts. */
  result: Gen.PrivacyExportResult | Record<string, number> | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  livemode: boolean;
  [key: string]: unknown;
}

/** A person: one customer across clicks, installs and your customer ID. */
export interface Person extends Gen.PersonInfoResponse {
  object: 'person';
  [key: string]: unknown;
}

/** A person as `people.search` lists them. */
export interface PersonSummary extends Gen.PersonSummaryResponse {
  [key: string]: unknown;
}

/** An app install. */
export interface Install extends Gen.InstallInfoResponse {
  object: 'install';
  [key: string]: unknown;
}

/** A payment report decided by a trusted confirmation (`payment.*` webhooks). */
export interface PaymentReport extends Gen.PaymentReportInfoResponse {
  object: 'payment_report';
  [key: string]: unknown;
}

/** A conversion as `conversion.*` webhooks show it. */
export interface ConversionObject extends Gen.ConversionInfoResponse {
  object: 'conversion';
  [key: string]: unknown;
}

/** The answer of `codes.redeem`. */
export interface CodeRedemption {
  object: 'code_redemption';
  offline_touch_id: string;
  code: { code: string; kind: string; link_id: string | null; campaign_id: string | null; referrer_id: string | null; program_id: string | null; [key: string]: unknown };
  /** The referral the redemption created or found; `null` otherwise. */
  referral: Referral | null;
  /** True once the touch is tied to an install. */
  linked: boolean;
  /** Why a referral code didn't create a referral (e.g. `already_referred`); `null` otherwise. */
  referral_error?: { code: string; message: string; [key: string]: unknown } | null;
  livemode: boolean;
  [key: string]: unknown;
}

/** A goal event as `goal.completed` and `goal.reversed` webhooks show it. */
export interface WebhookGoalEvent {
  object: 'goal_event';
  id: string;
  goal: string | null;
  /** Normal units as a decimal string. */
  value: string | null;
  value_minor: number | null;
  currency: string | null;
  first_for_click: boolean | null;
  is_first_customer: boolean | null;
  link: { id: string; [key: string]: unknown } | null;
  campaign: { id: string; [key: string]: unknown } | null;
  clicked_at: string | null;
  occurred_at: string;
  /** The attribution state, e.g. `attributed`. */
  status: string;
  received_as: string | null;
  goal_group: { id: string; name: string; [key: string]: unknown } | null;
  /** Your reference; absent in private mode. */
  reference?: string | null;
  /** `goal.completed` only: the event's person. */
  person?: { id: string; label?: string | null; [key: string]: unknown } | null;
  backfilled?: boolean | null;
  livemode: boolean;
  [key: string]: unknown;
}

/** One phone of a device change (a coarse model only). */
export interface DeviceChangeSide {
  platform: string;
  device_model: string | null;
  [key: string]: unknown;
}

/** A customer moving to another phone (`kind: 'switch'`) or adding one (`second_device`): the `person.device_changed` object. */
export interface DeviceChange {
  object: 'device_change';
  /** `{device_change_id}:{kind}` */
  id: string;
  device_change_id: string;
  person_id: string;
  customer_id: string | null;
  app_id: string;
  kind: 'switch' | 'second_device' | (string & {});
  from: DeviceChangeSide;
  to: DeviceChangeSide;
  from_last_seen_at: string | null;
  to_first_open_at: string;
  /** Days between the two phones, for a switch; `null` for a second device. */
  gap_days: number | null;
  livemode: boolean;
  [key: string]: unknown;
}

/** One page of `people.search`. */
export type PersonSearchPage = ListPage<PersonSummary>;

/** The fields of `links.create` (the API's `AddLinkSchema`). */
export type LinkCreateParams = Gen.AddLinkSchema;
/** The fields of `links.update` (the API's `UpdateLinkSchema`); `null` clears a field. */
export type LinkUpdateParams = Gen.UpdateLinkSchema;
