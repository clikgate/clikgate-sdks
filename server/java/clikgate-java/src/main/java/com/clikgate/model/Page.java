package com.clikgate.model;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/** One page of a list: {@code data}, {@code has_more}, {@code next_cursor}. */
public final class Page<T> extends WireObject {
  private final List<T> data;

  public Page(@Nullable Map<String, ?> fields, Function<Map<String, ?>, T> make) {
    super(fields);
    this.data = objects("data", make);
  }

  /** This page's items. */
  public List<T> getData() {
    return data;
  }

  /** True when another page follows. */
  public boolean hasMore() {
    return Boolean.TRUE.equals(bool("has_more"));
  }

  /** Pass it as the next page's cursor; null on the last page. */
  public @Nullable String getNextCursor() {
    return string("next_cursor");
  }
}
