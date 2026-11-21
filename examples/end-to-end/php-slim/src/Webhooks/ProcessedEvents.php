<?php

declare(strict_types=1);

namespace App\Webhooks;

use App\State;

/**
 * Webhook event IDs already handled. Delivery is at least once, so the same event can arrive again.
 * In your app: a table `clikgate_webhook_events (event_id PRIMARY KEY, received_at)`, where the unique key makes
 * markNew() safe when two deliveries race.
 */
final class ProcessedEvents
{
    public function __construct(private readonly State $state) {}

    /** True the first time an event ID is seen, false for a repeat delivery. */
    public function markNew(string $eventId): bool
    {
        if (isset($this->state->tables['webhook_events'][$eventId])) {
            return false;
        }
        $this->state->tables['webhook_events'][$eventId] = gmdate(\DATE_ATOM); // received_at

        return true;
    }
}
