<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** An install of one of your apps. */
final class Install extends Model
{
    /** `ins_…` */
    public readonly string $id;
    public readonly string $appId;
    public readonly string $installationId;
    public readonly string $platform;
    public readonly string $firstOpenAt;
    public readonly ?string $appVersion;
    public readonly ?string $sdkVersion;
    public readonly ?string $osVersion;
    public readonly ?string $deviceModel;
    public readonly ?string $country;
    public readonly bool $isReinstall;
    /** `attributed`, `organic`, … */
    public readonly string $attributionStatus;
    public readonly ?string $matchType;
    public readonly ?string $clickId;
    public readonly ?string $clickedAt;
    public readonly ?string $attributedAt;
    /** @var array<string, mixed>|null the link (`id`, `kind`, `external_reference`, `campaign_id`, `metadata`) */
    public readonly ?array $link;
    public readonly ?string $campaignId;
    /** Your customer ID (wire `customer_user_id`). */
    public readonly ?string $customerId;
    public readonly bool $identityVerified;
    public readonly ?string $lastSeenAt;
    public readonly string $uninstallStatus;
    /** The install's person (`per_…`), or null. */
    public readonly ?string $personId;
    public readonly string $createdAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->appId = self::string($data, 'app_id');
        $this->installationId = self::string($data, 'installation_id');
        $this->platform = self::string($data, 'platform');
        $this->firstOpenAt = self::string($data, 'first_open_at');
        $this->appVersion = self::str($data, 'app_version');
        $this->sdkVersion = self::str($data, 'sdk_version');
        $this->osVersion = self::str($data, 'os_version');
        $this->deviceModel = self::str($data, 'device_model');
        $this->country = self::str($data, 'country');
        $this->isReinstall = self::bool($data, 'is_reinstall') ?? false;
        $this->attributionStatus = self::string($data, 'attribution_status');
        $this->matchType = self::str($data, 'match_type');
        $this->clickId = self::str($data, 'click_id');
        $this->clickedAt = self::str($data, 'clicked_at');
        $this->attributedAt = self::str($data, 'attributed_at');
        $this->link = self::map($data, 'link');
        $this->campaignId = self::str($data, 'campaign_id');
        $this->customerId = self::str($data, 'customer_user_id');
        $this->identityVerified = self::bool($data, 'identity_verified') ?? false;
        $this->lastSeenAt = self::str($data, 'last_seen_at');
        $this->uninstallStatus = self::string($data, 'uninstall_status');
        $person = self::map($data, 'person');
        $this->personId = null === $person ? null : self::str($person, 'id');
        $this->createdAt = self::string($data, 'created_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
