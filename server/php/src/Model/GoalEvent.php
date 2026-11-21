<?php

declare(strict_types=1);

namespace Clikgate\Model;

/** A goal event as `goal.completed` and `goal.reversed` webhooks show it. */
final class GoalEvent extends Model
{
    /** `cnv_…` */
    public readonly string $id;
    public readonly ?string $goal;
    /** Normal units as a decimal string, e.g. `'7500.00'`. */
    public readonly ?string $value;
    public readonly ?int $valueMinor;
    public readonly ?string $currency;
    public readonly ?bool $firstForClick;
    public readonly ?bool $isFirstCustomer;
    /** The link's ID (wire `link.id`), or null. */
    public readonly ?string $linkId;
    /** The campaign's ID (wire `campaign.id`), or null. */
    public readonly ?string $campaignId;
    public readonly ?string $clickedAt;
    public readonly string $occurredAt;
    /** The attribution state, e.g. `attributed`. */
    public readonly string $status;
    /** The alias the event arrived as; null when sent as the goal's key. */
    public readonly ?string $receivedAs;
    /** Your reference; null in private mode. */
    public readonly ?string $reference;
    /** The event's person (`per_…`), or null. */
    public readonly ?string $personId;
    /** True for an event counted from before the goal was set up. */
    public readonly bool $backfilled;

    /** @param array<string, mixed> $data */
    public function __construct(array $data)
    {
        parent::__construct($data);
        $this->id = self::string($data, 'id');
        $this->goal = self::str($data, 'goal');
        $this->value = self::str($data, 'value');
        $this->valueMinor = self::int($data, 'value_minor');
        $this->currency = self::str($data, 'currency');
        $this->firstForClick = self::bool($data, 'first_for_click');
        $this->isFirstCustomer = self::bool($data, 'is_first_customer');
        $link = self::map($data, 'link');
        $this->linkId = null === $link ? null : self::str($link, 'id');
        $campaign = self::map($data, 'campaign');
        $this->campaignId = null === $campaign ? null : self::str($campaign, 'id');
        $this->clickedAt = self::str($data, 'clicked_at');
        $this->occurredAt = self::string($data, 'occurred_at');
        $this->status = self::string($data, 'status');
        $this->receivedAs = self::str($data, 'received_as');
        $this->reference = self::str($data, 'reference');
        $person = self::map($data, 'person');
        $this->personId = null === $person ? null : self::str($person, 'id');
        $this->backfilled = self::bool($data, 'backfilled') ?? false;
    }
}
