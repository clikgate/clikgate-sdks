package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A goal event ({@code POST /v1/goals/events}). */
public final class GoalEvent extends WireObject {
  public GoalEvent(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  /**
   * The outcome of the call: {@link GoalStatus#COUNTED}, {@link GoalStatus#WAITING} (a Payment goal waiting for its
   * confirmation, or a goal waiting for its click) or {@link GoalStatus#REFUSED}; null for a status this SDK version
   * doesn't know ({@code get("status")} has the wire string).
   */
  public @Nullable GoalStatus getStatus() {
    return GoalStatus.fromValue(string("status"));
  }

  /** The goal's kind, {@link GoalKind#STANDARD} or {@link GoalKind#PAYMENT}; null when unknown to this SDK version. */
  public @Nullable GoalKind getGoalKind() {
    return GoalKind.fromValue(string("goal_kind"));
  }

  /**
   * The event's attribution state: {@code attributed}, {@code unattributed}, {@code rejected_bot}, … (null while a
   * Payment goal waits for its confirmation).
   */
  public @Nullable String getEventStatus() {
    return string("event_status");
  }

  /** True when the value was dropped (a browser or app sent a value for a Payment goal). */
  public boolean isValueIgnored() {
    return Boolean.TRUE.equals(bool("value_ignored"));
  }

  /**
   * For a Payment goal sent by your server: {@code confirmation_id}, {@code match_status}, {@code report_id} and
   * {@code provider}; null otherwise.
   */
  public @Nullable Map<String, @Nullable Object> getPayment() {
    return map("payment");
  }

  public @Nullable String getGoal() {
    return string("goal");
  }

  /** Your reference; null in private mode. */
  public @Nullable String getReference() {
    return string("reference");
  }

  /** Normal units as a decimal string, e.g. {@code "2000000"}. */
  public @Nullable String getValue() {
    return string("value");
  }

  /** {@link #getValue()} as a BigDecimal. */
  public @Nullable BigDecimal getValueDecimal() {
    return decimal("value");
  }

  /**
   * The same amount in the currency's minor units (kobo, cents), e.g. {@code 200000000}; null
   * without a value.
   */
  public @Nullable Long getValueMinor() {
    return longValue("value_minor");
  }

  /**
   * The reversed amount in normal units as a decimal string, or null when nothing was
   * reversed.
   */
  public @Nullable String getReversedValue() {
    return string("reversed_value");
  }

  /** {@link #getReversedValue()} in minor units, or null. */
  public @Nullable Long getReversedValueMinor() {
    return longValue("reversed_value_minor");
  }

  private @Nullable Long longValue(String key) {
    Object v = get(key);
    return v instanceof Number ? Long.valueOf(((Number) v).longValue()) : null;
  }

  public @Nullable String getCurrency() {
    return string("currency");
  }

  /** Whether this event counts in totals: the same as {@code getStatus() == GoalStatus.COUNTED}. */
  public boolean isCounted() {
    return Boolean.TRUE.equals(bool("counted"));
  }

  /**
   * Null when counted; else why, e.g. {@code waiting_for_confirmation}, {@code already_counted_for_click},
   * {@code rejected_bot} (a plain string: new reasons can appear).
   */
  public @Nullable String getReason() {
    return string("reason");
  }

  public @Nullable Boolean getFirstForClick() {
    return bool("first_for_click");
  }

  /** {@code link_id}, {@code campaign_id}, {@code clicked_at}, or null when unattributed. */
  public @Nullable Map<String, @Nullable Object> getAttributedTo() {
    return map("attributed_to");
  }

  public @Nullable String getOccurredAt() {
    return string("occurred_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }
}
