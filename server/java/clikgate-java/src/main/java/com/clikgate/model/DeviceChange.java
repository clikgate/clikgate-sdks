package com.clikgate.model;

import java.time.Instant;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * A customer moving to another phone, or adding one (the {@code person.device_changed} webhook,
 * {@link WebhookEvent#asDeviceChange()}). Coarse device models only.
 */
public final class DeviceChange extends WireObject {
  public DeviceChange(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** {@code <device_change_id>:<kind>}. */
  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getDeviceChangeId() {
    return string("device_change_id");
  }

  /** The person ({@code per_...}). */
  public @Nullable String getPersonId() {
    return string("person_id");
  }

  /** Your user ID for the customer, or null. */
  public @Nullable String getCustomerId() {
    return string("customer_id");
  }

  public @Nullable String getAppId() {
    return string("app_id");
  }

  /** {@code switch} (moved to another phone) or {@code second_device} (added one). */
  public @Nullable String getKind() {
    return string("kind");
  }

  /** The earlier phone. */
  public @Nullable Side getFrom() {
    return object("from", Side::new);
  }

  /** The new phone. */
  public @Nullable Side getTo() {
    return object("to", Side::new);
  }

  /** When the earlier phone was last seen, or null. */
  public @Nullable Instant getFromLastSeenAt() {
    return instant("from_last_seen_at");
  }

  /** When the new phone first opened the app. */
  public @Nullable Instant getToFirstOpenAt() {
    return instant("to_first_open_at");
  }

  /** Days between the two, for a switch; null for a second device. */
  public @Nullable Integer getGapDays() {
    return intNumber("gap_days");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** One phone. */
  public static final class Side extends WireObject {
    public Side(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    /** {@code ios} or {@code android}. */
    public @Nullable String getPlatform() {
      return string("platform");
    }

    public @Nullable String getDeviceModel() {
      return string("device_model");
    }
  }
}
