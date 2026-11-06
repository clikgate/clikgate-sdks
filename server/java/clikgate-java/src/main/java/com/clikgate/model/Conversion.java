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
