<?php

declare(strict_types=1);

namespace Clikgate\Model;

/**
 * A link. Every field of the API's link is a property; `$link['short_url']` (array access over the wire keys) keeps
 * working.
 */
final class Link extends Model
{
    /** `lnk_…` */
    public readonly string $id;
    public readonly string $shortUrl;
    public readonly string $domain;
    /** `'premium'` on `ciz.to` links, else null. */
    public readonly ?string $domainBadge;
    public readonly ?string $domainGroupId;
    /** @var list<array<string, mixed>> every URL of the link (`domain`, `url`, `role`) */
    public readonly array $urls;
    public readonly string $slug;
    /** `active`, `paused`, `archived`, `expired`, … */
    public readonly string $status;
    public readonly string $destinationUrl;
    public readonly ?string $fallbackUrl;
    public readonly ?string $clickIdParam;
    public readonly ?string $utmTemplate;
    public readonly ?int $attributionWindowDays;
    /** Your own reference (`links->getByReference()`). */
    public readonly ?string $externalReference;
    public readonly ?string $campaignId;
    public readonly ?string $endGoalKey;
    public readonly ?string $title;
    public readonly ?string $ogTitle;
    public readonly ?string $ogDescription;
    public readonly ?string $ogImageUrl;
    /** @var list<string> */
    public readonly array $tags;
    /** @var array<string, mixed> your own free-form data */
    public readonly array $metadata;
    public readonly ?string $expiresAt;
    public readonly ?string $pausedReason;
    public readonly ?string $kind;
    /** @var list<string> */
    public readonly array $appIds;
    public readonly ?string $deepLinkPath;
    /** @var array<string, mixed> your own free-form deep-link data */
    public readonly array $deepLinkData;
    public readonly ?string $appBehavior;
    public readonly ?string $iosInterstitial;
    public readonly ?string $referralProgramId;
    public readonly ?string $referrerId;
    public readonly bool $underReview;
    /** True when destination, fallback and deep-link changes are refused (`409 link_locked`). */
    public readonly bool $locked;
    public readonly ?string $lockedBy;
    public readonly ?string $lockedAt;
    public readonly ?string $openInApp;
    /** @var list<array<string, mixed>> non-blocking findings (`code`, `message`, `param`), e.g. `no_preview` */
    public readonly array $warnings;
    public readonly string $createdAt;
    public readonly string $updatedAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->shortUrl = self::string($data, 'short_url');
        $this->domain = self::string($data, 'domain');
        $this->domainBadge = self::str($data, 'domain_badge');
        $this->domainGroupId = self::str($data, 'domain_group_id');
        $this->urls = self::maps($data, 'urls');
        $this->slug = self::string($data, 'slug');
        $this->status = self::string($data, 'status');
        $this->destinationUrl = self::string($data, 'destination_url');
        $this->fallbackUrl = self::str($data, 'fallback_url');
        $this->clickIdParam = self::str($data, 'click_id_param');
        $this->utmTemplate = self::str($data, 'utm_template');
        $this->attributionWindowDays = self::int($data, 'attribution_window_days');
        $this->externalReference = self::str($data, 'external_reference');
        $this->campaignId = self::str($data, 'campaign_id');
        $this->endGoalKey = self::str($data, 'end_goal_key');
        $this->title = self::str($data, 'title');
        $this->ogTitle = self::str($data, 'og_title');
        $this->ogDescription = self::str($data, 'og_description');
        $this->ogImageUrl = self::str($data, 'og_image_url');
        $this->tags = self::strings($data, 'tags');
        $this->metadata = self::map($data, 'metadata') ?? [];
        $this->expiresAt = self::str($data, 'expires_at');
        $this->pausedReason = self::str($data, 'paused_reason');
        $this->kind = self::str($data, 'kind');
        $this->appIds = self::strings($data, 'app_ids');
        $this->deepLinkPath = self::str($data, 'deep_link_path');
        $this->deepLinkData = self::map($data, 'deep_link_data') ?? [];
        $this->appBehavior = self::str($data, 'app_behavior');
        $this->iosInterstitial = self::str($data, 'ios_interstitial');
        $this->referralProgramId = self::str($data, 'referral_program_id');
        $this->referrerId = self::str($data, 'referrer_id');
        $this->underReview = self::bool($data, 'under_review') ?? false;
        $this->locked = self::bool($data, 'locked') ?? false;
        $this->lockedBy = self::str($data, 'locked_by');
        $this->lockedAt = self::str($data, 'locked_at');
        $this->openInApp = self::str($data, 'open_in_app');
        $this->warnings = self::maps($data, 'warnings');
        $this->createdAt = self::string($data, 'created_at');
        $this->updatedAt = self::string($data, 'updated_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
