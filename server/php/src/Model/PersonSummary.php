<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A person as `people->search()` lists them. */
final class PersonSummary extends Model
{
    public readonly string $id;
    public readonly ?string $label;
    public readonly ?string $clickId;
    /** Your customer ID (wire `customer_user_id`). */
    public readonly ?string $customerId;
    public readonly ?string $lastSeenAt;
    /** Goals counted. */
    public readonly int $goals;
    /** @var array<string, int> goal value per currency, in minor units */
    public readonly array $goalValueMinor;
    /** `label`, `customer_id` or `click_id`. */
    public readonly ?string $matchedOn;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->label = self::str($data, 'label');
        $this->clickId = self::str($data, 'click_id');
        $this->customerId = self::str($data, 'customer_user_id');
        $this->lastSeenAt = self::str($data, 'last_seen_at');
        $this->goals = self::int($data, 'goals') ?? 0;
        $values = [];
        foreach (self::map($data, 'goal_value_minor') ?? [] as $currency => $minor) {
            if (\is_int($minor)) {
                $values[(string) $currency] = $minor;
            }
        }
        $this->goalValueMinor = $values;
        $this->matchedOn = self::str($data, 'matched_on');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
