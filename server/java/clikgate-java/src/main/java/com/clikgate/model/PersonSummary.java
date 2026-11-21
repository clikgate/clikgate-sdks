package com.clikgate.model;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A person as {@code people().search(...)} lists them. {@code people().get(id)} has the full {@link Person}. */
public final class PersonSummary extends WireObject {
  public PersonSummary(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The person ID ({@code per_...}). */
  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getLabel() {
    return string("label");
  }

  public @Nullable String getClickId() {
    return string("click_id");
  }

  /** Your user ID for this person (wire {@code customer_user_id}), or null. */
  public @Nullable String getCustomerId() {
    return string("customer_user_id");
  }

  public @Nullable Instant getLastSeenAt() {
    return instant("last_seen_at");
  }

  /** How many goal events the person has. */
  public long getGoals() {
    return longOrZero("goals");
  }

  /** The person's goal value per currency, in minor units. */
  public Map<String, Long> getGoalValueMinor() {
    Map<String, Long> out = new LinkedHashMap<>();
    for (Map.Entry<String, @Nullable Object> e : mapOrEmpty("goal_value_minor").entrySet()) {
      if (e.getValue() instanceof Number) {
        out.put(e.getKey(), Long.valueOf(((Number) e.getValue()).longValue()));
      }
    }
    return java.util.Collections.unmodifiableMap(out);
  }

  /** What the search matched: {@code label}, {@code customer_id} or {@code click_id}; null without a query. */
  public @Nullable String getMatchedOn() {
    return string("matched_on");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }
}
