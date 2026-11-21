<?php

declare(strict_types=1);

namespace Clikgate\Model;

use Clikgate\Enum\EventType;

/**
 * A verified webhook event. `data` is the raw payload (and `$event['type']`, `$event['data']['object']` keep
 * working); the `as…()` accessors give the typed object, or null for an event of another family.
 *
 * ```php
 * $event = Webhooks::verify($rawBody, $signature, $secret);
 * $referral = $event->asReferral();          // null unless a referral.* event
 * if (null !== $referral && EventType::ReferralQualified === $event->type) {
 *     grantReward($referral->referrer->customerId, $referral->reward?->referrer?->amount);
 * }
 * ```
 */
final class WebhookEvent extends Model
{
    /** `evt_…`: dedupe on it, delivery is at-least-once. */
    public readonly string $id;
    /** e.g. `referral.qualified`; compare with the {@see EventType} constants. */
    public readonly string $type;
    public readonly string $apiVersion;
    public readonly string $createdAt;
    public readonly string $organizationId;
    public readonly bool $livemode;
    /** @var array<string, mixed> the raw payload: `object`, `previous_attributes`, … */
    public readonly array $data;

    /** @param array<string, mixed> $event */
    public function __construct(array $event)
    {
        parent::__construct($event);
        $this->id = self::string($event, 'id');
        $this->type = self::string($event, 'type');
        $this->apiVersion = self::string($event, 'api_version');
        $this->createdAt = self::string($event, 'created_at');
        $this->organizationId = self::string($event, 'organization_id');
        $this->livemode = self::bool($event, 'livemode') ?? false;
        $this->data = self::map($event, 'data') ?? [];
    }

    /** The type when this SDK release lists it in {@see EventType}, else null (compare `$event->type` with the constants directly). */
    public function eventType(): ?string
    {
        return EventType::isKnown($this->type) ? $this->type : null;
    }

    /** `referral.*`: the referral, with reward amounts; else null. */
    public function asReferral(): ?Referral
    {
        $o = $this->objectOf('referral');

        return null === $o ? null : new Referral($o);
    }

    /** `referrer.*`: the referrer; else null. */
    public function asReferrer(): ?Referrer
    {
        $o = $this->objectOf('referrer');

        return null === $o ? null : new Referrer($o);
    }

    /** `goal.completed` / `goal.reversed`: the goal event as webhooks show it; else null. */
    public function asGoalEvent(): ?GoalEvent
    {
        $o = $this->objectOf('goal');

        return null === $o ? null : new GoalEvent($o);
    }

    /** `install.*`: the install; else null. */
    public function asInstall(): ?Install
    {
        $o = $this->objectOf('install');

        return null === $o ? null : new Install($o);
    }

    /** `payment.*`: the payment report; else null. */
    public function asPayment(): ?PaymentReport
    {
        $o = $this->objectOf('payment');

        return null === $o ? null : new PaymentReport($o);
    }

    /** `conversion.*`: the conversion; else null. */
    public function asConversion(): ?Conversion
    {
        $o = $this->objectOf('conversion');

        return null === $o ? null : new Conversion($o);
    }

    /** @return array<string, mixed>|null */
    private function objectOf(string $family): ?array
    {
        if (!str_starts_with($this->type, $family . '.')) {
            return null;
        }
        $object = $this->data['object'] ?? null;
        if (!\is_array($object) || ([] !== $object && array_is_list($object))) {
            return null;
        }
        /** @var array<string, mixed> $object */
        return $object;
    }
}
