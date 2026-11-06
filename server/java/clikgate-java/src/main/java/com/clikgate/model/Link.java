package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A link ({@code /v1/links}). Every field is in {@link #toMap()}. */
public final class Link extends WireObject {
  public Link(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getShortUrl() {
    return string("short_url");
  }

  public @Nullable String getDestinationUrl() {
    return string("destination_url");
  }

  public @Nullable String getStatus() {
    return string("status");
  }

  /** Your own ID for this link ({@code external_reference}), else null. */
  public @Nullable String getExternalReference() {
    return string("external_reference");
  }

  /**
   * Your own keys on this link ({@code metadata}, e.g. {@code seller_id}); empty when it has none. Results can be
   * grouped ({@code group_by=metadata.<key>}) and filtered ({@code metadata[<key>]}) by them.
   */
  public Map<String, @Nullable Object> getMetadata() {
    Map<String, @Nullable Object> m = map("metadata");
    return m == null ? java.util.Collections.<String, @Nullable Object>emptyMap() : java.util.Collections.unmodifiableMap(m);
  }

  /** {@code "premium"} on {@code ciz.to} links, else null. */
  public @Nullable String getDomainBadge() {
    return string("domain_badge");
  }

  /** True when destination, fallback and deep-link changes are refused ({@code 409 link_locked}). */
  public boolean isLocked() {
    return Boolean.TRUE.equals(bool("locked"));
  }

  /** Non-blocking warnings ({@code code}, {@code message}, {@code param}), e.g. {@code no_preview}. */
  public List<Map<String, @Nullable Object>> getWarnings() {
    List<Map<String, @Nullable Object>> out = new ArrayList<>();
    for (Object o : list("warnings")) {
      @SuppressWarnings("unchecked")
      Map<String, @Nullable Object> m = o instanceof Map ? (Map<String, @Nullable Object>) o : null;
      if (m != null) {
        out.add(m);
      }
    }
    return out;
  }
}
