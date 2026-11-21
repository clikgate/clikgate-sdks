package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * A conversion (older API). For a Payment goal, {@code POST /v1/conversions} answers with the goal event instead
 * ({@code object: "goal_event"}): check {@link #isGoalEvent()} and read it with {@link #asGoalEvent()}.
 */
public final class Conversion extends WireObject {
  public Conversion(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getStatus() {
    return string("status");
  }

  /** Your ID for the conversion ({@code external_id}). */
  public @Nullable String getExternalId() {
    return string("external_id");
  }

  /** {@code purchase}, {@code signup}, ... */
  public @Nullable String getType() {
    return string("type");
  }

  /** The amount in the currency's minor units, or null. */
  public @Nullable Long getAmountMinor() {
    return longNumber("amount_minor");
  }

  /** {@link #getAmountMinor()} in normal units (exact, ISO 4217 decimals), or null. */
  public @Nullable BigDecimal getAmount() {
    return com.clikgate.internal.Currencies.toNormalUnits(getAmountMinor(), getCurrency());
  }

  public @Nullable String getCurrency() {
    return string("currency");
  }

  /** How much was reversed, in minor units. */
  public long getReversedAmountMinor() {
    return longOrZero("reversed_amount_minor");
  }

  public @Nullable String getClickId() {
    return string("click_id");
  }

  /** The goal, when the conversion was recorded for one. */
  public @Nullable String getGoal() {
    return string("goal");
  }

  /** {@code conversion}, or {@code goal_event} when the conversion was for a Payment goal. */
  public @Nullable String getObject() {
    return string("object");
  }

  /** Whether the API answered with the goal event (a Payment goal). */
  public boolean isGoalEvent() {
    return "goal_event".equals(getObject());
  }

  /** The same answer read as a {@link GoalEvent} (meaningful when {@link #isGoalEvent()}). */
  public GoalEvent asGoalEvent() {
    return new GoalEvent(toMap());
  }
}
