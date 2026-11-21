package com.clikgate.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A payment report, decided by a trusted confirmation ({@code payment.*} webhooks). Every field is in {@link #toMap()}. */
public final class PaymentReport extends WireObject {
  public PaymentReport(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  /** The payment provider: a {@link Provider} constant, or a newer one. */
  public @Nullable Provider getProvider() {
    String v = string("provider");
    return v == null ? null : Provider.fromString(v);
  }

  /** The payment reference (masked in private mode). */
  public @Nullable String getReference() {
    return string("reference");
  }

  /** Who reported the payment: {@code app}, {@code web}, {@code server}, ... */
  public @Nullable String getSource() {
    return string("source");
  }

  /** The Payment goal. */
  public @Nullable String getGoal() {
    return string("goal");
  }

  /** {@code pending}, {@code verified}, {@code rejected}, {@code not_confirmed}, {@code refunded}, ... */
  public @Nullable String getStatus() {
    return string("status");
  }

  public @Nullable String getStatusReason() {
    return string("status_reason");
  }

  public @Nullable String getClickId() {
    return string("click_id");
  }

  public @Nullable String getInstallationId() {
    return string("installation_id");
  }

  public @Nullable String getLinkId() {
    return string("link_id");
  }

  /** True when the verified payment counts in totals. */
  public boolean isCounted() {
    return Boolean.TRUE.equals(bool("counted"));
  }

  /** The goal event counted for this payment, or null. */
  public @Nullable String getGoalEventId() {
    return string("goal_event_id");
  }

  /** How much was refunded, in minor units. */
  public long getRefundedAmountMinor() {
    return longOrZero("refunded_amount_minor");
  }

  public List<String> getFlags() {
    return strings("flags");
  }

  public @Nullable Instant getOccurredAt() {
    return instant("occurred_at");
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getDecidedAt() {
    return instant("decided_at");
  }

  public @Nullable Instant getExpiresAt() {
    return instant("expires_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }
}
