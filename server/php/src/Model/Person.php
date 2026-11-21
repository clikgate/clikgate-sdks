<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A person: one customer across clicks, installs and your customer ID. */
final class Person extends Model
{
    /** `per_…` */
    public readonly string $id;
    public readonly ?string $label;
    public readonly ?string $labelSource;
    public readonly ?string $labelUpdatedAt;
    /** Your customer ID (wire `customer_user_id`). */
    public readonly ?string $customerId;
    public readonly ?string $customerIdHint;
    public readonly ?string $clickId;
    public readonly ?string $mergedInto;
    public readonly string $createdAt;
    public readonly ?string $lastSeenAt;
    /** @var list<array<string, mixed>> */
    public readonly array $links;
    /** @var list<array<string, mixed>> */
    public readonly array $labelHistory;
    /** @var list<array<string, mixed>> */
    public readonly array $timeline;
    public readonly bool $canUnmerge;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->label = self::str($data, 'label');
        $this->labelSource = self::str($data, 'label_source');
        $this->labelUpdatedAt = self::str($data, 'label_updated_at');
        $this->customerId = self::str($data, 'customer_user_id');
        $this->customerIdHint = self::str($data, 'customer_user_id_hint');
        $this->clickId = self::str($data, 'click_id');
        $this->mergedInto = self::str($data, 'merged_into');
        $this->createdAt = self::string($data, 'created_at');
        $this->lastSeenAt = self::str($data, 'last_seen_at');
        $this->links = self::maps($data, 'links');
        $this->labelHistory = self::maps($data, 'label_history');
        $this->timeline = self::maps($data, 'timeline');
        $this->canUnmerge = self::bool($data, 'can_unmerge') ?? false;
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
