<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A customer who refers others in a referral program. */
final class Referrer extends Model
{
    /** `rfr_…` */
    public readonly string $id;
    public readonly string $programId;
    /** Your customer ID (wire `customer_user_id`). */
    public readonly string $customerId;
    public readonly ?string $displayName;
    /** The referral code. */
    public readonly string $code;
    public readonly ?string $externalCode;
    public readonly ?string $linkId;
    /** The code URL, else the short link. */
    public readonly ?string $url;
    public readonly ?string $shortUrl;
    /** `active` or `blocked`. */
    public readonly string $status;
    public readonly ?string $blockedReason;
    public readonly ?string $blockedAt;
    public readonly ReferrerStats $stats;
    /** @var array<string, mixed> your own free-form data about the referrer */
    public readonly array $attributes;
    public readonly bool $leaderboardOptOut;
    public readonly ?int $qualityScore;
    /** `good`, `watch` or `poor`; null until scored. */
    public readonly ?string $qualityBand;
    public readonly ?string $lastActivityAt;
    public readonly string $createdAt;
    public readonly string $updatedAt;
    public readonly bool $livemode;
    /** From `getOrCreateReferrer()`: true when it was just created (the API answered 201); else null. */
    public readonly ?bool $created;

    /** @param array<string, mixed> $data */
    public function __construct(array $data, ?bool $created = null)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->programId = self::string($data, 'program_id');
        $this->customerId = self::string($data, 'customer_user_id');
        $this->displayName = self::str($data, 'display_name');
        $this->code = self::string($data, 'code');
        $this->externalCode = self::str($data, 'external_code');
        $this->linkId = self::str($data, 'link_id');
        $this->url = self::str($data, 'url');
        $this->shortUrl = self::str($data, 'short_url');
        $this->status = self::string($data, 'status');
        $this->blockedReason = self::str($data, 'blocked_reason');
        $this->blockedAt = self::str($data, 'blocked_at');
        $this->stats = new ReferrerStats(self::map($data, 'stats') ?? []);
        $this->attributes = self::map($data, 'attributes') ?? [];
        $this->leaderboardOptOut = self::bool($data, 'leaderboard_opt_out') ?? false;
        $this->qualityScore = self::int($data, 'quality_score');
        $this->qualityBand = self::str($data, 'quality_band');
        $this->lastActivityAt = self::str($data, 'last_activity_at');
        $this->createdAt = self::string($data, 'created_at');
        $this->updatedAt = self::string($data, 'updated_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
        $this->created = $created;
    }

    protected function derived(): array
    {
        return null === $this->created ? [] : ['created' => $this->created];
    }
}
