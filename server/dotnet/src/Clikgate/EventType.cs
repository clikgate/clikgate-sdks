using System.Collections.Generic;
using System.Diagnostics.CodeAnalysis;

namespace Clikgate;

/// <summary>
/// Every webhook event type, as <c>const string</c>s so they work in a <c>switch</c> on <see cref="WebhookEvent.Type"/>.
/// New types can appear: keep a default branch.
/// </summary>
/// <example><code>
/// switch (ev.Type)
/// {
///     case EventType.REFERRAL_QUALIFIED:
///         var referral = ev.AsReferral();
///         break;
/// }
/// </code></example>
[SuppressMessage("Naming", "CA1707", Justification = "Upper-case members, as in the other Clikgate SDKs.")]
public static class EventType
{
    /// <summary><c>link.created</c></summary>
    public const string LINK_CREATED = "link.created";

    /// <summary><c>link.updated</c></summary>
    public const string LINK_UPDATED = "link.updated";

    /// <summary><c>link.paused</c></summary>
    public const string LINK_PAUSED = "link.paused";

    /// <summary><c>link.resumed</c></summary>
    public const string LINK_RESUMED = "link.resumed";

    /// <summary><c>link.archived</c></summary>
    public const string LINK_ARCHIVED = "link.archived";

    /// <summary><c>link.expired</c></summary>
    public const string LINK_EXPIRED = "link.expired";

    /// <summary><c>link.flagged</c></summary>
    public const string LINK_FLAGGED = "link.flagged";

    /// <summary><c>link.stats.hourly</c></summary>
    public const string LINK_STATS_HOURLY = "link.stats.hourly";

    /// <summary><c>link.destination_changed</c></summary>
    public const string LINK_DESTINATION_CHANGED = "link.destination_changed";

    /// <summary><c>campaign.paused</c></summary>
    public const string CAMPAIGN_PAUSED = "campaign.paused";

    /// <summary><c>campaign.resumed</c></summary>
    public const string CAMPAIGN_RESUMED = "campaign.resumed";

    /// <summary><c>conversion.attributed</c></summary>
    public const string CONVERSION_ATTRIBUTED = "conversion.attributed";

    /// <summary><c>conversion.unattributed</c></summary>
    public const string CONVERSION_UNATTRIBUTED = "conversion.unattributed";

    /// <summary><c>conversion.reversed</c></summary>
    public const string CONVERSION_REVERSED = "conversion.reversed";

    /// <summary><c>domain.status_changed</c></summary>
    public const string DOMAIN_STATUS_CHANGED = "domain.status_changed";

    /// <summary><c>job.completed</c></summary>
    public const string JOB_COMPLETED = "job.completed";

    /// <summary><c>webhook_endpoint.disabled</c></summary>
    public const string WEBHOOK_ENDPOINT_DISABLED = "webhook_endpoint.disabled";

    /// <summary><c>webhook.test</c></summary>
    public const string WEBHOOK_TEST = "webhook.test";

    /// <summary><c>install.attributed</c></summary>
    public const string INSTALL_ATTRIBUTED = "install.attributed";

    /// <summary><c>install.organic</c></summary>
    public const string INSTALL_ORGANIC = "install.organic";

    /// <summary><c>install.attribution_updated</c></summary>
    public const string INSTALL_ATTRIBUTION_UPDATED = "install.attribution_updated";

    /// <summary><c>install.uninstalled</c></summary>
    public const string INSTALL_UNINSTALLED = "install.uninstalled";

    /// <summary><c>install.uninstall_reverted</c></summary>
    public const string INSTALL_UNINSTALL_REVERTED = "install.uninstall_reverted";

    /// <summary><c>person.device_changed</c></summary>
    public const string PERSON_DEVICE_CHANGED = "person.device_changed";

    /// <summary><c>app.reengaged</c></summary>
    public const string APP_REENGAGED = "app.reengaged";

    /// <summary><c>app.push_credentials_invalid</c></summary>
    public const string APP_PUSH_CREDENTIALS_INVALID = "app.push_credentials_invalid";

    /// <summary><c>referral.created</c></summary>
    public const string REFERRAL_CREATED = "referral.created";

    /// <summary><c>referral.step_completed</c></summary>
    public const string REFERRAL_STEP_COMPLETED = "referral.step_completed";

    /// <summary><c>referral.holding</c></summary>
    public const string REFERRAL_HOLDING = "referral.holding";

    /// <summary><c>referral.qualified</c></summary>
    public const string REFERRAL_QUALIFIED = "referral.qualified";

    /// <summary><c>referral.disqualified</c></summary>
    public const string REFERRAL_DISQUALIFIED = "referral.disqualified";

    /// <summary><c>referral.rejected</c></summary>
    public const string REFERRAL_REJECTED = "referral.rejected";

    /// <summary><c>referral.referee_uninstalled</c></summary>
    public const string REFERRAL_REFEREE_UNINSTALLED = "referral.referee_uninstalled";

    /// <summary><c>referrer.created</c></summary>
    public const string REFERRER_CREATED = "referrer.created";

    /// <summary><c>referrer.blocked</c></summary>
    public const string REFERRER_BLOCKED = "referrer.blocked";

    /// <summary><c>referrer.unblocked</c></summary>
    public const string REFERRER_UNBLOCKED = "referrer.unblocked";

    /// <summary><c>referrer.quality_changed</c></summary>
    public const string REFERRER_QUALITY_CHANGED = "referrer.quality_changed";

    /// <summary><c>skan.postback_received</c></summary>
    public const string SKAN_POSTBACK_RECEIVED = "skan.postback_received";

    /// <summary><c>leaderboard.period_closed</c></summary>
    public const string LEADERBOARD_PERIOD_CLOSED = "leaderboard.period_closed";

    /// <summary><c>leaderboard.period_finalized</c></summary>
    public const string LEADERBOARD_PERIOD_FINALIZED = "leaderboard.period_finalized";

    /// <summary><c>leaderboard.rank_changed</c></summary>
    public const string LEADERBOARD_RANK_CHANGED = "leaderboard.rank_changed";

    /// <summary><c>leaderboard.target_reached</c></summary>
    public const string LEADERBOARD_TARGET_REACHED = "leaderboard.target_reached";

    /// <summary><c>leaderboard.target_revoked</c></summary>
    public const string LEADERBOARD_TARGET_REVOKED = "leaderboard.target_revoked";

    /// <summary><c>challenge.scheduled</c></summary>
    public const string CHALLENGE_SCHEDULED = "challenge.scheduled";

    /// <summary><c>challenge.started</c></summary>
    public const string CHALLENGE_STARTED = "challenge.started";

    /// <summary><c>challenge.ended</c></summary>
    public const string CHALLENGE_ENDED = "challenge.ended";

    /// <summary><c>challenge.finalized</c></summary>
    public const string CHALLENGE_FINALIZED = "challenge.finalized";

    /// <summary><c>challenge.cancelled</c></summary>
    public const string CHALLENGE_CANCELLED = "challenge.cancelled";

    /// <summary><c>identity.duplicate_detected</c></summary>
    public const string IDENTITY_DUPLICATE_DETECTED = "identity.duplicate_detected";

    /// <summary><c>whatsapp.conversation_attributed</c></summary>
    public const string WHATSAPP_CONVERSATION_ATTRIBUTED = "whatsapp.conversation_attributed";

    /// <summary><c>code.redeemed</c></summary>
    public const string CODE_REDEEMED = "code.redeemed";

    /// <summary><c>organization.feature_changed</c></summary>
    public const string ORGANIZATION_FEATURE_CHANGED = "organization.feature_changed";

    /// <summary><c>organization.feature_data_purged</c></summary>
    public const string ORGANIZATION_FEATURE_DATA_PURGED = "organization.feature_data_purged";

    /// <summary><c>alert.triggered</c></summary>
    public const string ALERT_TRIGGERED = "alert.triggered";

    /// <summary><c>alert.resolved</c></summary>
    public const string ALERT_RESOLVED = "alert.resolved";

    /// <summary><c>app_banner.published</c></summary>
    public const string APP_BANNER_PUBLISHED = "app_banner.published";

    /// <summary><c>app_banner.paused</c></summary>
    public const string APP_BANNER_PAUSED = "app_banner.paused";

    /// <summary><c>domain.group_changed</c></summary>
    public const string DOMAIN_GROUP_CHANGED = "domain.group_changed";

    /// <summary><c>domain.settings_updated</c></summary>
    public const string DOMAIN_SETTINGS_UPDATED = "domain.settings_updated";

    /// <summary><c>subscription.activated</c></summary>
    public const string SUBSCRIPTION_ACTIVATED = "subscription.activated";

    /// <summary><c>subscription.renewed</c></summary>
    public const string SUBSCRIPTION_RENEWED = "subscription.renewed";

    /// <summary><c>subscription.changed</c></summary>
    public const string SUBSCRIPTION_CHANGED = "subscription.changed";

    /// <summary><c>subscription.grace_started</c></summary>
    public const string SUBSCRIPTION_GRACE_STARTED = "subscription.grace_started";

    /// <summary><c>subscription.expired</c></summary>
    public const string SUBSCRIPTION_EXPIRED = "subscription.expired";

    /// <summary><c>subscription.cancelled</c></summary>
    public const string SUBSCRIPTION_CANCELLED = "subscription.cancelled";

    /// <summary><c>subscription.updated</c></summary>
    public const string SUBSCRIPTION_UPDATED = "subscription.updated";

    /// <summary><c>subscription.trial_started</c></summary>
    public const string SUBSCRIPTION_TRIAL_STARTED = "subscription.trial_started";

    /// <summary><c>subscription.trial_extended</c></summary>
    public const string SUBSCRIPTION_TRIAL_EXTENDED = "subscription.trial_extended";

    /// <summary><c>subscription.trial_converted</c></summary>
    public const string SUBSCRIPTION_TRIAL_CONVERTED = "subscription.trial_converted";

    /// <summary><c>subscription.trial_ended</c></summary>
    public const string SUBSCRIPTION_TRIAL_ENDED = "subscription.trial_ended";

    /// <summary><c>usage.threshold_reached</c></summary>
    public const string USAGE_THRESHOLD_REACHED = "usage.threshold_reached";

    /// <summary><c>fraud.install_flagged</c></summary>
    public const string FRAUD_INSTALL_FLAGGED = "fraud.install_flagged";

    /// <summary><c>privacy.request_completed</c></summary>
    public const string PRIVACY_REQUEST_COMPLETED = "privacy.request_completed";

    /// <summary><c>sale.matched</c></summary>
    public const string SALE_MATCHED = "sale.matched";

    /// <summary><c>sale.refunded</c></summary>
    public const string SALE_REFUNDED = "sale.refunded";

    /// <summary><c>organization.deleted</c></summary>
    public const string ORGANIZATION_DELETED = "organization.deleted";

    /// <summary><c>invoice.issued</c></summary>
    public const string INVOICE_ISSUED = "invoice.issued";

    /// <summary><c>invoice.paid</c></summary>
    public const string INVOICE_PAID = "invoice.paid";

    /// <summary><c>invoice.voided</c></summary>
    public const string INVOICE_VOIDED = "invoice.voided";

    /// <summary><c>receipt.issued</c></summary>
    public const string RECEIPT_ISSUED = "receipt.issued";

    /// <summary><c>credit_note.issued</c></summary>
    public const string CREDIT_NOTE_ISSUED = "credit_note.issued";

    /// <summary><c>goal.completed</c></summary>
    public const string GOAL_COMPLETED = "goal.completed";

    /// <summary><c>goal.reversed</c></summary>
    public const string GOAL_REVERSED = "goal.reversed";

    /// <summary><c>payment.verified</c></summary>
    public const string PAYMENT_VERIFIED = "payment.verified";

    /// <summary><c>payment.rejected</c></summary>
    public const string PAYMENT_REJECTED = "payment.rejected";

    /// <summary><c>payment.not_confirmed</c></summary>
    public const string PAYMENT_NOT_CONFIRMED = "payment.not_confirmed";

    /// <summary><c>payment.refunded</c></summary>
    public const string PAYMENT_REFUNDED = "payment.refunded";

    /// <summary><c>partner_reward.approved</c></summary>
    public const string PARTNER_REWARD_APPROVED = "partner_reward.approved";

    /// <summary><c>partner_reward.applied</c></summary>
    public const string PARTNER_REWARD_APPLIED = "partner_reward.applied";

    /// <summary><c>partner_reward.removed</c></summary>
    public const string PARTNER_REWARD_REMOVED = "partner_reward.removed";

    /// <summary><c>partner_reward.reversed</c></summary>
    public const string PARTNER_REWARD_REVERSED = "partner_reward.reversed";

    /// <summary><c>partner.approved</c></summary>
    public const string PARTNER_APPROVED = "partner.approved";

    /// <summary><c>partner_earning.approved</c></summary>
    public const string PARTNER_EARNING_APPROVED = "partner_earning.approved";

    /// <summary><c>partner_payout.paid</c></summary>
    public const string PARTNER_PAYOUT_PAID = "partner_payout.paid";

    /// <summary><c>ab_test.likely_winner</c></summary>
    public const string AB_TEST_LIKELY_WINNER = "ab_test.likely_winner";

    /// <summary><c>click.created</c></summary>
    public const string CLICK_CREATED = "click.created";

    /// <summary><c>funnel.stuck</c></summary>
    public const string FUNNEL_STUCK = "funnel.stuck";

    /// <summary>Every type above.</summary>
    public static IReadOnlyCollection<string> All { get; } = new HashSet<string>
    {
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
        FUNNEL_STUCK,
    };
}
