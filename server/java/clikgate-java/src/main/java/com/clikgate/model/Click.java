package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A click ({@code /v1/clicks/{id}}). */
public final class Click extends WireObject {
  public Click(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getCountry() {
    return string("country");
  }

  public @Nullable Map<String, @Nullable Object> getLink() {
    return map("link");
  }
}
