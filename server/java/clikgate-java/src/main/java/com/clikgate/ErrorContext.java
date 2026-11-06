package com.clikgate;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/** What {@code onError} receives next to the exception (SPEC 9.5). Never values, metadata or consent. */
public final class ErrorContext {
  private final String operation;
  private final List<Map<String, String>> events;
  private final boolean dropped;

  public ErrorContext(String operation, List<Map<String, String>> events, boolean dropped) {
    this.operation = operation;
    this.events = Collections.unmodifiableList(events);
    this.dropped = dropped;
  }

  /** {@code goal}, {@code goals.batch} or {@code config}. */
  public String getOperation() {
    return operation;
  }

  /** The affected events as {@code {goal, reference}}; references are {@code [redacted]} while private mode is on. */
  public List<Map<String, String>> getEvents() {
    return events;
  }

  /** True when the events won't be retried. */
  public boolean isDropped() {
    return dropped;
  }
}
