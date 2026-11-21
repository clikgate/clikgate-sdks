<?php

declare(strict_types=1);

namespace Clikgate\Model;

/**
 * A customer moving to another phone (`kind` `switch`) or adding one (`second_device`): the object of a
 * `person.device_changed` webhook. Array access reads the wire keys (`$change['from']['platform']`).
 */
final class DeviceChange extends Model
{
    /** `{device_change_id}:{kind}` */
    public readonly string $id;
    public readonly string $deviceChangeId;
    public readonly string $personId;
    /** Your customer ID, when the person is identified. */
    public readonly ?string $customerId;
    public readonly string $appId;
    /** `switch` or `second_device`. */
    public readonly string $kind;
    /** The earlier phone (wire `from`). */
    public readonly DeviceChangeSide $from;
    /** The new phone (wire `to`). */
    public readonly DeviceChangeSide $to;
    public readonly ?string $fromLastSeenAt;
    public readonly string $toFirstOpenAt;
    /** Days between the two phones, for a switch; null for a second device. */
    public readonly ?int $gapDays;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->deviceChangeId = self::string($data, 'device_change_id');
        $this->personId = self::string($data, 'person_id');
        $this->customerId = self::str($data, 'customer_id');
        $this->appId = self::string($data, 'app_id');
        $this->kind = self::string($data, 'kind');
        $this->from = new DeviceChangeSide(self::map($data, 'from') ?? []);
        $this->to = new DeviceChangeSide(self::map($data, 'to') ?? []);
        $this->fromLastSeenAt = self::str($data, 'from_last_seen_at');
        $this->toFirstOpenAt = self::string($data, 'to_first_open_at');
        $this->gapDays = self::int($data, 'gap_days');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
