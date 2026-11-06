package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A destination change waiting for a second person (the {@code 202} answer of {@code links().update}). */
public final class LinkChangeRequest extends WireObject {
  public LinkChangeRequest(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getLinkId() {
    return string("link_id");
  }

  /** {@code pending}, {@code approved}, {@code rejected} or {@code expired}. */
  public @Nullable String getStatus() {
    return string("status");
  }

  public @Nullable String getFromUrl() {
    return string("from_url");
  }

  public @Nullable String getToUrl() {
    return string("to_url");
  }

  public @Nullable String getExpiresAt() {
    return string("expires_at");
  }
}
