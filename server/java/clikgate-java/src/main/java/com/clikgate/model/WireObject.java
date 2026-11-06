package com.clikgate.model;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * A wire object (the API's JSON, {@code snake_case} keys) with typed getters. Nothing is lost: {@link #toMap()}
 * returns every field, including ones this SDK version doesn't know yet.
 */
public class WireObject {
  private final Map<String, @Nullable Object> fields;

  protected WireObject(@Nullable Map<String, ?> fields) {
    this.fields = fields == null ? Collections.<String, @Nullable Object>emptyMap() : Collections.unmodifiableMap(new LinkedHashMap<String, @Nullable Object>(fields));
  }

  /** Every field, as the API sent it. */
  public Map<String, @Nullable Object> toMap() {
    return fields;
  }

  /** One field, as the API sent it. */
  public @Nullable Object get(String key) {
    return fields.get(key);
  }

  protected @Nullable String string(String key) {
    Object v = fields.get(key);
    return v instanceof String ? (String) v : null;
  }

  protected @Nullable Boolean bool(String key) {
    Object v = fields.get(key);
    return v instanceof Boolean ? (Boolean) v : null;
  }

  protected @Nullable BigDecimal decimal(String key) {
    String v = string(key);
    return v == null ? null : new BigDecimal(v);
  }

  @SuppressWarnings("unchecked")
  protected @Nullable Map<String, @Nullable Object> map(String key) {
    Object v = fields.get(key);
    return v instanceof Map ? (Map<String, @Nullable Object>) v : null;
  }

  @SuppressWarnings("unchecked")
  protected List<@Nullable Object> list(String key) {
    Object v = fields.get(key);
    return v instanceof List ? (List<@Nullable Object>) v : Collections.<@Nullable Object>emptyList();
  }

  @SuppressWarnings("unchecked")
  static @Nullable Map<String, ?> asMap(@Nullable Object v) {
    return v instanceof Map ? (Map<String, ?>) v : null;
  }

  @Override
  public String toString() {
    return getClass().getSimpleName() + fields;
  }

  @Override
  public boolean equals(@Nullable Object o) {
    return o instanceof WireObject && o.getClass() == getClass() && ((WireObject) o).fields.equals(fields);
  }

  @Override
  public int hashCode() {
    return fields.hashCode();
  }
}
