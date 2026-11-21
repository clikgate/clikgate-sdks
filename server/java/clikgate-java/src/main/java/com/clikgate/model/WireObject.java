package com.clikgate.model;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
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

  /** A whole number field, or null. */
  protected @Nullable Long longNumber(String key) {
    Object v = fields.get(key);
    return v instanceof Number ? Long.valueOf(((Number) v).longValue()) : null;
  }

  /** A whole number field, or 0 when absent. */
  protected long longOrZero(String key) {
    Long v = longNumber(key);
    return v == null ? 0L : v.longValue();
  }

  /** A whole number field, or null. */
  protected @Nullable Integer intNumber(String key) {
    Object v = fields.get(key);
    return v instanceof Number ? Integer.valueOf(((Number) v).intValue()) : null;
  }

  /** A number field (decimal fractions kept), or null. */
  protected @Nullable Double doubleNumber(String key) {
    Object v = fields.get(key);
    return v instanceof Number ? Double.valueOf(((Number) v).doubleValue()) : null;
  }

  /** An RFC 3339 timestamp field, or null when absent or not a timestamp. */
  protected @Nullable Instant instant(String key) {
    String v = string(key);
    if (v == null) {
      return null;
    }
    try {
      return OffsetDateTime.parse(v).toInstant();
    } catch (DateTimeParseException e) {
      return null;
    }
  }

  /** A list of strings (other items skipped); empty when absent. */
  protected List<String> strings(String key) {
    List<String> out = new ArrayList<>();
    for (Object o : list(key)) {
      if (o instanceof String) {
        out.add((String) o);
      }
    }
    return Collections.unmodifiableList(out);
  }

  /** A map field, read-only; empty when absent. */
  protected Map<String, @Nullable Object> mapOrEmpty(String key) {
    Map<String, @Nullable Object> m = map(key);
    return m == null ? Collections.<String, @Nullable Object>emptyMap() : Collections.unmodifiableMap(m);
  }

  /** A nested object field read as {@code T}, or null when absent. */
  protected <T> @Nullable T object(String key, Function<Map<String, ?>, T> make) {
    Map<String, @Nullable Object> m = map(key);
    return m == null ? null : make.apply(m);
  }

  /** A list of nested objects read as {@code T} (other items skipped); empty when absent. */
  protected <T> List<T> objects(String key, Function<Map<String, ?>, T> make) {
    List<T> out = new ArrayList<>();
    for (Object o : list(key)) {
      Map<String, ?> m = asMap(o);
      if (m != null) {
        out.add(make.apply(m));
      }
    }
    return Collections.unmodifiableList(out);
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
