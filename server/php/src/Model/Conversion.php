<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A conversion as `conversion.*` webhooks show it. */
final class Conversion extends Model
{
    /** `cnv_…` */
    public readonly string $id;
    public readonly string $externalId;
    /** `attributed`, `unattributed`, … */
    public readonly string $status;
    public readonly string $type;
    public readonly ?int $amountMinor;
    public readonly ?string $currency;
    public readonly int $reversedAmountMinor;
    public readonly ?string $clickId;
    public readonly ?string $goal;
    /** Normal units as a decimal string. */
    public readonly ?string $value;
    /** @var array<string, mixed> your own free-form data */
    public readonly array $metadata;
    public readonly string $occurredAt;
    public readonly string $receivedAt;
    public readonly string $createdAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->externalId = self::string($data, 'external_id');
        $this->status = self::string($data, 'status');
        $this->type = self::string($data, 'type');
        $this->amountMinor = self::int($data, 'amount_minor');
        $this->currency = self::str($data, 'currency');
        $this->reversedAmountMinor = self::int($data, 'reversed_amount_minor') ?? 0;
        $this->clickId = self::str($data, 'click_id');
        $this->goal = self::str($data, 'goal');
        $this->value = self::str($data, 'value');
        $this->metadata = self::map($data, 'metadata') ?? [];
        $this->occurredAt = self::string($data, 'occurred_at');
        $this->receivedAt = self::string($data, 'received_at');
        $this->createdAt = self::string($data, 'created_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
