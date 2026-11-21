<?php

declare(strict_types=1);

namespace Clikgate\Enum;

/**
 * Every webhook event type the API sends (SPEC section 29.1), as string constants holding the wire value. An event's
 * `type` stays a plain string, so a type added later is never an error.
 *
 * ```php
 * if (EventType::ReferralQualified === $event->type) { … }
 * ```
 */
final class EventType
{
    public const AbTestLikelyWinner = 'ab_test.likely_winner';
    public const AlertResolved = 'alert.resolved';
    public const AlertTriggered = 'alert.triggered';
    public const AppPushCredentialsInvalid = 'app.push_credentials_invalid';
    public const AppReengaged = 'app.reengaged';
    public const AppBannerPaused = 'app_banner.paused';
    public const AppBannerPublished = 'app_banner.published';
    public const CampaignPaused = 'campaign.paused';
    public const CampaignResumed = 'campaign.resumed';
    public const ChallengeCancelled = 'challenge.cancelled';
    public const ChallengeEnded = 'challenge.ended';
    public const ChallengeFinalized = 'challenge.finalized';
    public const ChallengeScheduled = 'challenge.scheduled';
    public const ChallengeStarted = 'challenge.started';
    public const ClickCreated = 'click.created';
    public const CodeRedeemed = 'code.redeemed';
    public const ConversionAttributed = 'conversion.attributed';
    public const ConversionReversed = 'conversion.reversed';
    public const ConversionUnattributed = 'conversion.unattributed';
    public const CreditNoteIssued = 'credit_note.issued';
    public const DomainGroupChanged = 'domain.group_changed';
    public const DomainSettingsUpdated = 'domain.settings_updated';
    public const DomainStatusChanged = 'domain.status_changed';
    public const FraudInstallFlagged = 'fraud.install_flagged';
    public const FunnelStuck = 'funnel.stuck';
    public const GoalCompleted = 'goal.completed';
    public const GoalReversed = 'goal.reversed';
    public const IdentityDuplicateDetected = 'identity.duplicate_detected';
    public const InstallAttributed = 'install.attributed';
    public const InstallAttributionUpdated = 'install.attribution_updated';
    public const InstallOrganic = 'install.organic';
    public const InstallUninstallReverted = 'install.uninstall_reverted';
    public const InstallUninstalled = 'install.uninstalled';
    public const InvoiceIssued = 'invoice.issued';
    public const InvoicePaid = 'invoice.paid';
    public const InvoiceVoided = 'invoice.voided';
    public const JobCompleted = 'job.completed';
    public const LeaderboardPeriodClosed = 'leaderboard.period_closed';
    public const LeaderboardPeriodFinalized = 'leaderboard.period_finalized';
    public const LeaderboardRankChanged = 'leaderboard.rank_changed';
    public const LeaderboardTargetReached = 'leaderboard.target_reached';
    public const LeaderboardTargetRevoked = 'leaderboard.target_revoked';
    public const LinkArchived = 'link.archived';
    public const LinkCreated = 'link.created';
    public const LinkDestinationChanged = 'link.destination_changed';
    public const LinkExpired = 'link.expired';
    public const LinkFlagged = 'link.flagged';
    public const LinkPaused = 'link.paused';
    public const LinkResumed = 'link.resumed';
    public const LinkStatsHourly = 'link.stats.hourly';
    public const LinkUpdated = 'link.updated';
    public const OrganizationDeleted = 'organization.deleted';
    public const OrganizationFeatureChanged = 'organization.feature_changed';
    public const OrganizationFeatureDataPurged = 'organization.feature_data_purged';
    public const PartnerApproved = 'partner.approved';
    public const PartnerEarningApproved = 'partner_earning.approved';
    public const PartnerPayoutPaid = 'partner_payout.paid';
    public const PartnerRewardApplied = 'partner_reward.applied';
    public const PartnerRewardApproved = 'partner_reward.approved';
    public const PartnerRewardRemoved = 'partner_reward.removed';
    public const PartnerRewardReversed = 'partner_reward.reversed';
    public const PaymentNotConfirmed = 'payment.not_confirmed';
    public const PaymentRefunded = 'payment.refunded';
    public const PaymentRejected = 'payment.rejected';
    public const PaymentVerified = 'payment.verified';
    public const PersonDeviceChanged = 'person.device_changed';
    public const PrivacyRequestCompleted = 'privacy.request_completed';
    public const ReceiptIssued = 'receipt.issued';
    public const ReferralCreated = 'referral.created';
    public const ReferralDisqualified = 'referral.disqualified';
    public const ReferralHolding = 'referral.holding';
    public const ReferralQualified = 'referral.qualified';
    public const ReferralRefereeUninstalled = 'referral.referee_uninstalled';
    public const ReferralRejected = 'referral.rejected';
    public const ReferralStepCompleted = 'referral.step_completed';
    public const ReferrerBlocked = 'referrer.blocked';
    public const ReferrerCreated = 'referrer.created';
    public const ReferrerQualityChanged = 'referrer.quality_changed';
    public const ReferrerUnblocked = 'referrer.unblocked';
    public const SaleMatched = 'sale.matched';
    public const SaleRefunded = 'sale.refunded';
    public const SkanPostbackReceived = 'skan.postback_received';
    public const SubscriptionActivated = 'subscription.activated';
    public const SubscriptionCancelled = 'subscription.cancelled';
    public const SubscriptionChanged = 'subscription.changed';
    public const SubscriptionExpired = 'subscription.expired';
    public const SubscriptionGraceStarted = 'subscription.grace_started';
    public const SubscriptionRenewed = 'subscription.renewed';
    public const SubscriptionTrialConverted = 'subscription.trial_converted';
    public const SubscriptionTrialEnded = 'subscription.trial_ended';
    public const SubscriptionTrialExtended = 'subscription.trial_extended';
    public const SubscriptionTrialStarted = 'subscription.trial_started';
    public const SubscriptionUpdated = 'subscription.updated';
    public const UsageThresholdReached = 'usage.threshold_reached';
    public const WebhookTest = 'webhook.test';
    public const WebhookEndpointDisabled = 'webhook_endpoint.disabled';
    public const WhatsappConversationAttributed = 'whatsapp.conversation_attributed';

    /**
     * Every constant's wire value, in declaration order.
     *
     * @return list<string>
     */
    public static function all(): array
    {
        /** @var list<string> */
        return array_values((new \ReflectionClass(self::class))->getConstants());
    }

    /** Whether `$type` is a type this SDK release lists. */
    public static function isKnown(string $type): bool
    {
        return \in_array($type, self::all(), true);
    }

    private function __construct() {}
}
