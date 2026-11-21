package com.example.clikgate.webhooks;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Webhook event IDs already handled. Delivery is at least once, so the same event can arrive again.
 * In your app: a table {@code clikgate_webhook_events (event_id PRIMARY KEY, received_at)}, where the unique key
 * makes {@link #markNew} safe when two deliveries race.
 */
@Component
public class ProcessedEvents {
  private final Set<String> eventIds = ConcurrentHashMap.newKeySet();

  /** True the first time an event ID is seen, false for a repeat delivery. */
  public boolean markNew(String eventId) {
    return eventIds.add(eventId);
  }
}
