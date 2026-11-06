package com.clikgate.model;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** {@code GET /v1/server-sdk/config} (private mode, click-ID parameter, goals, minimum SDK versions). */
public final class ServerSdkConfig extends WireObject {
  public ServerSdkConfig(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public boolean isPrivateMode() {
    return Boolean.TRUE.equals(bool("private_mode"));
  }

  public @Nullable String getClickIdParam() {
    return string("click_id_param");
  }

  public @Nullable String getMode() {
    return string("mode");
  }

  /** The goals: {@code key}, {@code value_mode} ({@code none}, {@code optional}, {@code required}), {@code default_currency}. */
  public List<Map<String, @Nullable Object>> getGoals() {
    List<Map<String, @Nullable Object>> out = new ArrayList<>();
    for (Object o : list("goals")) {
      @SuppressWarnings("unchecked")
      Map<String, @Nullable Object> m = o instanceof Map ? (Map<String, @Nullable Object>) o : null;
      if (m != null) {
        out.add(m);
      }
    }
    return out;
  }

  public @Nullable String minimumVersion(String sdk) {
    Map<String, @Nullable Object> m = map("minimum_sdk_versions");
    Object v = m == null ? null : m.get(sdk);
    return v instanceof String ? (String) v : null;
  }
}
