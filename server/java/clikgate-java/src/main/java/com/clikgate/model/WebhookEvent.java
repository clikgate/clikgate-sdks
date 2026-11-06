package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A webhook event: {@code id}, {@code type} (e.g. {@code goal.completed}, {@code link.destination_changed}, {@code subscription.updated}), {@code data}, … */
public final class WebhookEvent extends WireObject {
  public WebhookEvent(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getType() {
    return string("type");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** {@code object} and the event's extra keys (e.g. {@code from}, {@code to}, {@code actor} on {@code link.destination_changed}; {@code change}, {@code add_on_key} on {@code subscription.updated}). */
  public @Nullable Map<String, @Nullable Object> getData() {
    return map("data");
  }
}
