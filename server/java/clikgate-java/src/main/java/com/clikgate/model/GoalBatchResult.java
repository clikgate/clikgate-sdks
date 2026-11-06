package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** {@code POST /v1/goals/events/batch}: one item per event, in order. */
public final class GoalBatchResult extends WireObject {
  public GoalBatchResult(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** One item: {@code index}, {@code ok}, {@code status}, and {@code goal_event} or {@code error}. */
  public static final class Item extends WireObject {
    Item(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public int getIndex() {
      Object v = get("index");
      return v instanceof Number ? ((Number) v).intValue() : -1;
    }

    public boolean isOk() {
      return Boolean.TRUE.equals(bool("ok"));
    }

    public int getStatus() {
      Object v = get("status");
      return v instanceof Number ? ((Number) v).intValue() : 0;
    }

    public @Nullable GoalEvent getGoalEvent() {
      Map<String, ?> m = asMap(get("goal_event"));
      return m == null ? null : new GoalEvent(m);
    }

    /** The error envelope ({@code type}, {@code code}, {@code message}, {@code param}) when {@code ok} is false. */
    public @Nullable Map<String, @Nullable Object> getError() {
      return map("error");
    }
  }

  public List<Item> getData() {
    List<Item> out = new ArrayList<>();
    for (Object o : list("data")) {
      out.add(new Item(asMap(o)));
    }
    return out;
  }
}
