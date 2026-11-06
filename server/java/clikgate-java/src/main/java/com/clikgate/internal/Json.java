package com.clikgate.internal;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Internal: JSON with Jackson (the one runtime dependency). Decimals stay exact; dates become RFC 3339 UTC. */
public final class Json {
  private static final ObjectMapper MAPPER =
      new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS).enable(DeserializationFeature.USE_BIG_INTEGER_FOR_INTS);

  private Json() {}

  /** Parse to Maps, Lists, Strings, Booleans, Long/Integer/BigInteger and BigDecimal; null for an empty body. */
  public static @Nullable Object parse(byte[] body) throws IOException {
    String text = new String(body, StandardCharsets.UTF_8);
    if (text.trim().isEmpty()) {
      return null;
    }
    return normaliseNumbers(MAPPER.readValue(text, Object.class));
  }

  private static @Nullable Object normaliseNumbers(@Nullable Object v) {
    if (v instanceof java.math.BigInteger) {
      java.math.BigInteger b = (java.math.BigInteger) v;
      return b.bitLength() < 32 ? (Object) b.intValue() : b.bitLength() < 64 ? (Object) b.longValue() : b;
    }
    if (v instanceof Map) {
      Map<String, Object> out = new LinkedHashMap<>();
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
        out.put(String.valueOf(e.getKey()), normaliseNumbers(e.getValue()));
      }
      return out;
    }
    if (v instanceof List) {
      List<@Nullable Object> out = new ArrayList<>();
      for (Object o : (List<?>) v) {
        out.add(normaliseNumbers(o));
      }
      return out;
    }
    return v;
  }

  /** UTF-8 JSON. Explicit nulls in maps are kept (PATCH uses them to clear a field). */
  public static byte[] write(@Nullable Object value) {
    try {
      return MAPPER.writeValueAsBytes(normalise(value));
    } catch (JsonProcessingException e) {
      throw new IllegalArgumentException("The request body can't be written as JSON: " + e.getOriginalMessage(), e);
    }
  }

  /** Dates to RFC 3339 strings, BigDecimals to plain strings is NOT done here (money is formatted explicitly). */
  static @Nullable Object normalise(@Nullable Object v) {
    if (v instanceof Instant || v instanceof OffsetDateTime || v instanceof ZonedDateTime || v instanceof Date) {
      return Dates.format(v);
    }
    if (v instanceof BigDecimal) {
      return v;
    }
    // the shared enums go on the wire as their values (a params map may hold Provider.PAYSTACK)
    if (v instanceof com.clikgate.model.Provider) {
      return ((com.clikgate.model.Provider) v).getValue();
    }
    if (v instanceof com.clikgate.model.GoalKind) {
      return ((com.clikgate.model.GoalKind) v).getValue();
    }
    if (v instanceof com.clikgate.model.GoalStatus) {
      return ((com.clikgate.model.GoalStatus) v).getValue();
    }
    if (v instanceof Map) {
      Map<String, @Nullable Object> out = new LinkedHashMap<>();
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
        out.put(String.valueOf(e.getKey()), normalise(e.getValue()));
      }
      return out;
    }
    if (v instanceof Collection) {
      List<@Nullable Object> out = new ArrayList<>();
      for (Object o : (Collection<?>) v) {
        out.add(normalise(o));
      }
      return out;
    }
    return v;
  }

  /** A JSON string for tests and the conformance runner. */
  public static String stringify(@Nullable Object value) {
    return new String(write(value), StandardCharsets.UTF_8);
  }

  /** Parse a JSON string. */
  public static @Nullable Object parse(String text) throws IOException {
    return parse(text.getBytes(StandardCharsets.UTF_8));
  }
}
