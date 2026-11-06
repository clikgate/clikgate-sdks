package com.clikgate.internal;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Date;

/** Internal: RFC 3339 UTC ({@code YYYY-MM-DDTHH:MM:SSZ}, with {@code .sss} only when the milliseconds aren't zero). */
public final class Dates {
  private static final DateTimeFormatter SECONDS = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss");

  private Dates() {}

  public static String format(Object value) {
    if (value instanceof String) {
      return (String) value;
    }
    Instant instant;
    if (value instanceof Instant) {
      instant = (Instant) value;
    } else if (value instanceof OffsetDateTime) {
      instant = ((OffsetDateTime) value).toInstant();
    } else if (value instanceof ZonedDateTime) {
      instant = ((ZonedDateTime) value).toInstant();
    } else if (value instanceof Date) {
      instant = ((Date) value).toInstant();
    } else {
      throw new IllegalArgumentException("Not a date: " + value.getClass().getName());
    }
    OffsetDateTime utc = instant.atOffset(ZoneOffset.UTC);
    int ms = utc.getNano() / 1_000_000;
    return utc.format(SECONDS) + (ms > 0 ? String.format(java.util.Locale.ROOT, ".%03dZ", ms) : "Z");
  }
}
