package com.clikgate.model;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** One page of links: {@code data}, {@code has_more}, {@code next_cursor}. */
public final class LinkPage extends WireObject {
  public LinkPage(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public List<Link> getData() {
    List<Link> out = new ArrayList<>();
    for (Object o : list("data")) {
      out.add(new Link(asMap(o)));
    }
    return out;
  }

  public boolean hasMore() {
    return Boolean.TRUE.equals(bool("has_more"));
  }

  public @Nullable String getNextCursor() {
    return string("next_cursor");
  }
}
