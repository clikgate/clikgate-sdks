package com.clikgate.model;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Every webhook event type, as {@code String} constants so they work in a {@code switch} on
 * {@link WebhookEvent#getType()}. New types can appear: keep a {@code default} branch.
 *
 * <pre>{@code
 * switch (event.getType()) {
 *   case EventType.REFERRAL_QUALIFIED:
 *     Referral referral = event.asReferral();
 *     break;
 *   default:
 *     break;
 * }
 * }</pre>
 */
public final class EventType {
  private EventType() {}

  /** {@code link.created} */
  public static final String LINK_CREATED = "link.created";

  /** {@code link.updated} */
  public static final String LINK_UPDATED = "link.updated";

  /** {@code link.paused} */
  public static final String LINK_PAUSED = "link.paused";

  /** {@code link.resumed} */
  public static final String LINK_RESUMED = "link.resumed";

  /** {@code link.archived} */
  public static final String LINK_ARCHIVED = "link.archived";

  /** {@code link.expired} */
  public static final String LINK_EXPIRED = "link.expired";

  /** {@code link.flagged} */
  public static final String LINK_FLAGGED = "link.flagged";

  /** {@code link.stats.hourly} */
  public static final String LINK_STATS_HOURLY = "link.stats.hourly";

  /** {@code link.destination_changed} */
  public static final String LINK_DESTINATION_CHANGED = "link.destination_changed";

  /** {@code campaign.paused} */
  public static final String CAMPAIGN_PAUSED = "campaign.paused";

  /** {@code campaign.resumed} */
  public static final String CAMPAIGN_RESUMED = "campaign.resumed";

  /** {@code conversion.attributed} */
  public static final String CONVERSION_ATTRIBUTED = "conversion.attributed";

  /** {@code conversion.unattributed} */
  public static final String CONVERSION_UNATTRIBUTED = "conversion.unattributed";

  /** {@code conversion.reversed} */
  public static final String CONVERSION_REVERSED = "conversion.reversed";

  /** {@code domain.status_changed} */
  public static final String DOMAIN_STATUS_CHANGED = "domain.status_changed";

  /** {@code job.completed} */
  public static final String JOB_COMPLETED = "job.completed";

  /** {@code webhook_endpoint.disabled} */
  public static final String WEBHOOK_ENDPOINT_DISABLED = "webhook_endpoint.disabled";

  /** {@code webhook.test} */
  public static final String WEBHOOK_TEST = "webhook.test";

  /** {@code install.attributed} */
  public static final String INSTALL_ATTRIBUTED = "install.attributed";

  /** {@code install.organic} */
  public static final String INSTALL_ORGANIC = "install.organic";

  /** {@code install.attribution_updated} */
  public static final String INSTALL_ATTRIBUTION_UPDATED = "install.attribution_updated";

  /** {@code install.uninstalled} */
  public static final String INSTALL_UNINSTALLED = "install.uninstalled";

  /** {@code install.uninstall_reverted} */
  public static final String INSTALL_UNINSTALL_REVERTED = "install.uninstall_reverted";

  /** {@code person.device_changed} */
  public static final String PERSON_DEVICE_CHANGED = "person.device_changed";

  /** {@code app.reengaged} */
  public static final String APP_REENGAGED = "app.reengaged";

  /** {@code app.push_credentials_invalid} */
  public static final String APP_PUSH_CREDENTIALS_INVALID = "app.push_credentials_invalid";

  /** {@code referral.created} */
  public static final String REFERRAL_CREATED = "referral.created";

  /** {@code referral.step_completed} */
  public static final String REFERRAL_STEP_COMPLETED = "referral.step_completed";

  /** {@code referral.holding} */
  public static final String REFERRAL_HOLDING = "referral.holding";

  /** {@code referral.qualified} */
  public static final String REFERRAL_QUALIFIED = "referral.qualified";

  /** {@code referral.disqualified} */
  public static final String REFERRAL_DISQUALIFIED = "referral.disqualified";

  /** {@code referral.rejected} */
  public static final String REFERRAL_REJECTED = "referral.rejected";

  /** {@code referral.referee_uninstalled} */
  public static final String REFERRAL_REFEREE_UNINSTALLED = "referral.referee_uninstalled";

  /** {@code referrer.created} */
  public static final String REFERRER_CREATED = "referrer.created";

  /** {@code referrer.blocked} */
  public static final String REFERRER_BLOCKED = "referrer.blocked";

  /** {@code referrer.unblocked} */
  public static final String REFERRER_UNBLOCKED = "referrer.unblocked";

  /** {@code referrer.quality_changed} */
  public static final String REFERRER_QUALITY_CHANGED = "referrer.quality_changed";

  /** {@code skan.postback_received} */
  public static final String SKAN_POSTBACK_RECEIVED = "skan.postback_received";

  /** {@code leaderboard.period_closed} */
  public static final String LEADERBOARD_PERIOD_CLOSED = "leaderboard.period_closed";

  /** {@code leaderboard.period_finalized} */
  public static final String LEADERBOARD_PERIOD_FINALIZED = "leaderboard.period_finalized";

  /** {@code leaderboard.rank_changed} */
  public static final String LEADERBOARD_RANK_CHANGED = "leaderboard.rank_changed";

  /** {@code leaderboard.target_reached} */
  public static final String LEADERBOARD_TARGET_REACHED = "leaderboard.target_reached";

  /** {@code leaderboard.target_revoked} */
  public static final String LEADERBOARD_TARGET_REVOKED = "leaderboard.target_revoked";

  /** {@code challenge.scheduled} */
  public static final String CHALLENGE_SCHEDULED = "challenge.scheduled";

  /** {@code challenge.started} */
  public static final String CHALLENGE_STARTED = "challenge.started";

  /** {@code challenge.ended} */
  public static final String CHALLENGE_ENDED = "challenge.ended";

  /** {@code challenge.finalized} */
  public static final String CHALLENGE_FINALIZED = "challenge.finalized";

  /** {@code challenge.cancelled} */
  public static final String CHALLENGE_CANCELLED = "challenge.cancelled";

  /** {@code identity.duplicate_detected} */
  public static final String IDENTITY_DUPLICATE_DETECTED = "identity.duplicate_detected";

  /** {@code whatsapp.conversation_attributed} */
  public static final String WHATSAPP_CONVERSATION_ATTRIBUTED = "whatsapp.conversation_attributed";

  /** {@code code.redeemed} */
  public static final String CODE_REDEEMED = "code.redeemed";

  /** {@code organization.feature_changed} */
  public static final String ORGANIZATION_FEATURE_CHANGED = "organization.feature_changed";

  /** {@code organization.feature_data_purged} */
  public static final String ORGANIZATION_FEATURE_DATA_PURGED = "organization.feature_data_purged";

  /** {@code alert.triggered} */
  public static final String ALERT_TRIGGERED = "alert.triggered";

  /** {@code alert.resolved} */
  public static final String ALERT_RESOLVED = "alert.resolved";

  /** {@code app_banner.published} */
  public static final String APP_BANNER_PUBLISHED = "app_banner.published";

  /** {@code app_banner.paused} */
  public static final String APP_BANNER_PAUSED = "app_banner.paused";

  /** {@code domain.group_changed} */
  public static final String DOMAIN_GROUP_CHANGED = "domain.group_changed";

  /** {@code domain.settings_updated} */
  public static final String DOMAIN_SETTINGS_UPDATED = "domain.settings_updated";

  /** {@code subscription.activated} */
  public static final String SUBSCRIPTION_ACTIVATED = "subscription.activated";

  /** {@code subscription.renewed} */
  public static final String SUBSCRIPTION_RENEWED = "subscription.renewed";

  /** {@code subscription.changed} */
  public static final String SUBSCRIPTION_CHANGED = "subscription.changed";

  /** {@code subscription.grace_started} */
  public static final String SUBSCRIPTION_GRACE_STARTED = "subscription.grace_started";

  /** {@code subscription.expired} */
  public static final String SUBSCRIPTION_EXPIRED = "subscription.expired";

  /** {@code subscription.cancelled} */
  public static final String SUBSCRIPTION_CANCELLED = "subscription.cancelled";

  /** {@code subscription.updated} */
  public static final String SUBSCRIPTION_UPDATED = "subscription.updated";

  /** {@code subscription.trial_started} */
  public static final String SUBSCRIPTION_TRIAL_STARTED = "subscription.trial_started";

  /** {@code subscription.trial_extended} */
  public static final String SUBSCRIPTION_TRIAL_EXTENDED = "subscription.trial_extended";

  /** {@code subscription.trial_converted} */
  public static final String SUBSCRIPTION_TRIAL_CONVERTED = "subscription.trial_converted";

  /** {@code subscription.trial_ended} */
  public static final String SUBSCRIPTION_TRIAL_ENDED = "subscription.trial_ended";

  /** {@code usage.threshold_reached} */
  public static final String USAGE_THRESHOLD_REACHED = "usage.threshold_reached";

  /** {@code fraud.install_flagged} */
  public static final String FRAUD_INSTALL_FLAGGED = "fraud.install_flagged";

  /** {@code privacy.request_completed} */
  public static final String PRIVACY_REQUEST_COMPLETED = "privacy.request_completed";

  /** {@code sale.matched} */
  public static final String SALE_MATCHED = "sale.matched";

  /** {@code sale.refunded} */
  public static final String SALE_REFUNDED = "sale.refunded";

  /** {@code organization.deleted} */
  public static final String ORGANIZATION_DELETED = "organization.deleted";

  /** {@code invoice.issued} */
  public static final String INVOICE_ISSUED = "invoice.issued";

  /** {@code invoice.paid} */
  public static final String INVOICE_PAID = "invoice.paid";

  /** {@code invoice.voided} */
  public static final String INVOICE_VOIDED = "invoice.voided";

  /** {@code receipt.issued} */
  public static final String RECEIPT_ISSUED = "receipt.issued";

  /** {@code credit_note.issued} */
  public static final String CREDIT_NOTE_ISSUED = "credit_note.issued";

  /** {@code goal.completed} */
  public static final String GOAL_COMPLETED = "goal.completed";

  /** {@code goal.reversed} */
  public static final String GOAL_REVERSED = "goal.reversed";

  /** {@code payment.verified} */
  public static final String PAYMENT_VERIFIED = "payment.verified";

  /** {@code payment.rejected} */
  public static final String PAYMENT_REJECTED = "payment.rejected";

  /** {@code payment.not_confirmed} */
  public static final String PAYMENT_NOT_CONFIRMED = "payment.not_confirmed";

  /** {@code payment.refunded} */
  public static final String PAYMENT_REFUNDED = "payment.refunded";

  /** {@code partner_reward.approved} */
  public static final String PARTNER_REWARD_APPROVED = "partner_reward.approved";

  /** {@code partner_reward.applied} */
  public static final String PARTNER_REWARD_APPLIED = "partner_reward.applied";

  /** {@code partner_reward.removed} */
  public static final String PARTNER_REWARD_REMOVED = "partner_reward.removed";

  /** {@code partner_reward.reversed} */
  public static final String PARTNER_REWARD_REVERSED = "partner_reward.reversed";

  /** {@code partner.approved} */
  public static final String PARTNER_APPROVED = "partner.approved";

  /** {@code partner_earning.approved} */
  public static final String PARTNER_EARNING_APPROVED = "partner_earning.approved";

  /** {@code partner_payout.paid} */
  public static final String PARTNER_PAYOUT_PAID = "partner_payout.paid";

  /** {@code ab_test.likely_winner} */
  public static final String AB_TEST_LIKELY_WINNER = "ab_test.likely_winner";

  /** {@code click.created} */
  public static final String CLICK_CREATED = "click.created";

  /** {@code funnel.stuck} */
  public static final String FUNNEL_STUCK = "funnel.stuck";

  /** Every type above. */
  public static final Set<String> ALL =
      Collections.unmodifiableSet(
          new LinkedHashSet<>(
              Arrays.asList(
                  LINK_CREATED,
                  LINK_UPDATED,
                  LINK_PAUSED,
                  LINK_RESUMED,
                  LINK_ARCHIVED,
                  LINK_EXPIRED,
                  LINK_FLAGGED,
                  LINK_STATS_HOURLY,
                  LINK_DESTINATION_CHANGED,
                  CAMPAIGN_PAUSED,
                  CAMPAIGN_RESUMED,
                  CONVERSION_ATTRIBUTED,
                  CONVERSION_UNATTRIBUTED,
                  CONVERSION_REVERSED,
                  DOMAIN_STATUS_CHANGED,
                  JOB_COMPLETED,
                  WEBHOOK_ENDPOINT_DISABLED,
                  WEBHOOK_TEST,
                  INSTALL_ATTRIBUTED,
                  INSTALL_ORGANIC,
                  INSTALL_ATTRIBUTION_UPDATED,
                  INSTALL_UNINSTALLED,
                  INSTALL_UNINSTALL_REVERTED,
                  PERSON_DEVICE_CHANGED,
                  APP_REENGAGED,
                  APP_PUSH_CREDENTIALS_INVALID,
                  REFERRAL_CREATED,
                  REFERRAL_STEP_COMPLETED,
                  REFERRAL_HOLDING,
                  REFERRAL_QUALIFIED,
                  REFERRAL_DISQUALIFIED,
                  REFERRAL_REJECTED,
                  REFERRAL_REFEREE_UNINSTALLED,
                  REFERRER_CREATED,
                  REFERRER_BLOCKED,
                  REFERRER_UNBLOCKED,
                  REFERRER_QUALITY_CHANGED,
                  SKAN_POSTBACK_RECEIVED,
                  LEADERBOARD_PERIOD_CLOSED,
                  LEADERBOARD_PERIOD_FINALIZED,
                  LEADERBOARD_RANK_CHANGED,
                  LEADERBOARD_TARGET_REACHED,
                  LEADERBOARD_TARGET_REVOKED,
                  CHALLENGE_SCHEDULED,
                  CHALLENGE_STARTED,
                  CHALLENGE_ENDED,
                  CHALLENGE_FINALIZED,
                  CHALLENGE_CANCELLED,
                  IDENTITY_DUPLICATE_DETECTED,
                  WHATSAPP_CONVERSATION_ATTRIBUTED,
                  CODE_REDEEMED,
                  ORGANIZATION_FEATURE_CHANGED,
                  ORGANIZATION_FEATURE_DATA_PURGED,
                  ALERT_TRIGGERED,
                  ALERT_RESOLVED,
                  APP_BANNER_PUBLISHED,
                  APP_BANNER_PAUSED,
                  DOMAIN_GROUP_CHANGED,
                  DOMAIN_SETTINGS_UPDATED,
                  SUBSCRIPTION_ACTIVATED,
                  SUBSCRIPTION_RENEWED,
                  SUBSCRIPTION_CHANGED,
                  SUBSCRIPTION_GRACE_STARTED,
                  SUBSCRIPTION_EXPIRED,
                  SUBSCRIPTION_CANCELLED,
                  SUBSCRIPTION_UPDATED,
                  SUBSCRIPTION_TRIAL_STARTED,
                  SUBSCRIPTION_TRIAL_EXTENDED,
                  SUBSCRIPTION_TRIAL_CONVERTED,
                  SUBSCRIPTION_TRIAL_ENDED,
                  USAGE_THRESHOLD_REACHED,
                  FRAUD_INSTALL_FLAGGED,
                  PRIVACY_REQUEST_COMPLETED,
                  SALE_MATCHED,
                  SALE_REFUNDED,
                  ORGANIZATION_DELETED,
                  INVOICE_ISSUED,
                  INVOICE_PAID,
                  INVOICE_VOIDED,
                  RECEIPT_ISSUED,
                  CREDIT_NOTE_ISSUED,
                  GOAL_COMPLETED,
                  GOAL_REVERSED,
                  PAYMENT_VERIFIED,
                  PAYMENT_REJECTED,
                  PAYMENT_NOT_CONFIRMED,
                  PAYMENT_REFUNDED,
                  PARTNER_REWARD_APPROVED,
                  PARTNER_REWARD_APPLIED,
                  PARTNER_REWARD_REMOVED,
                  PARTNER_REWARD_REVERSED,
                  PARTNER_APPROVED,
                  PARTNER_EARNING_APPROVED,
                  PARTNER_PAYOUT_PAID,
                  AB_TEST_LIKELY_WINNER,
                  CLICK_CREATED,
                  FUNNEL_STUCK)));
}
