<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A payment report decided by a trusted confirmation (`payment.*` webhooks). */
final class PaymentReport extends Model
{
    /** `prp_…` */
    public readonly string $id;
    public readonly string $provider;
    public readonly string $reference;
    public readonly string $source;
    public readonly string $goal;
    /** `verified`, `rejected`, `not_confirmed`, `refunded`, … */
    public readonly string $status;
    public readonly ?string $statusReason;
    public readonly ?string $clickId;
    public readonly ?string $installationId;
    public readonly ?string $linkId;
    public readonly ?string $channel;
    public readonly bool $counted;
    public readonly ?string $goalEventId;
    public readonly int $refundedAmountMinor;
    public readonly string $occurredAt;
    public readonly string $createdAt;
    public readonly ?string $decidedAt;
    public readonly string $expiresAt;
    public readonly bool $livemode;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->provider = self::string($data, 'provider');
        $this->reference = self::string($data, 'reference');
        $this->source = self::string($data, 'source');
        $this->goal = self::string($data, 'goal');
        $this->status = self::string($data, 'status');
        $this->statusReason = self::str($data, 'status_reason');
        $this->clickId = self::str($data, 'click_id');
        $this->installationId = self::str($data, 'installation_id');
        $this->linkId = self::str($data, 'link_id');
        $this->channel = self::str($data, 'channel');
        $this->counted = self::bool($data, 'counted') ?? false;
        $this->goalEventId = self::str($data, 'goal_event_id');
        $this->refundedAmountMinor = self::int($data, 'refunded_amount_minor') ?? 0;
        $this->occurredAt = self::string($data, 'occurred_at');
        $this->createdAt = self::string($data, 'created_at');
        $this->decidedAt = self::str($data, 'decided_at');
        $this->expiresAt = self::string($data, 'expires_at');
        $this->livemode = self::bool($data, 'livemode') ?? false;
    }
}
