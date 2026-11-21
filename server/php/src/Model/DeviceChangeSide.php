<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** One phone of a device change (a coarse model only). */
final class DeviceChangeSide extends Model
{
    public readonly string $platform;
    public readonly ?string $deviceModel;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->platform = self::string($data, 'platform');
        $this->deviceModel = self::str($data, 'device_model');
    }
}
