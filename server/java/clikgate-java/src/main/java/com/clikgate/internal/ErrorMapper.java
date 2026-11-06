package com.clikgate.internal;

import com.clikgate.exception.AuthenticationException;
import com.clikgate.exception.ClikgateException;
import com.clikgate.exception.ConflictException;
import com.clikgate.exception.IdempotencyException;
import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.LinkLockedException;
import com.clikgate.exception.NotFoundException;
import com.clikgate.exception.PermissionException;
import com.clikgate.exception.PrivateModeFieldRejectedException;
import com.clikgate.exception.RateLimitException;
import com.clikgate.exception.ServerException;
import java.nio.charset.StandardCharsets;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/** Internal: map HTTP responses to typed exceptions (SPEC 5, rules 3-13). */
public final class ErrorMapper {
  private static final int SNIPPET = 200;
  private static final Pattern DIGITS = Pattern.compile("[0-9]+");
  private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f]");

  private ErrorMapper() {}

  public static ClikgateException fromResponse(int status, Map<String, String> headers, byte[] body, long nowMs) {
    String text = new String(body, StandardCharsets.UTF_8);
    Map<String, Object> envelope = null;
    try {
      Object parsed = Json.parse(body);
      if (parsed instanceof Map && ((Map<?, ?>) parsed).get("error") instanceof Map) {
        envelope = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>) ((Map<?, ?>) parsed).get("error")).entrySet()) {
          envelope.put(String.valueOf(e.getKey()), e.getValue());
        }
      }
    } catch (Exception e) {
      envelope = null;
    }
    Map<String, Object> env = envelope == null ? Collections.<String, Object>emptyMap() : envelope;
    String requestId = str(env.get("request_id"));
    if (requestId == null) {
      requestId = header(headers, "x-request-id");
    }
    boolean redirect = status >= 300 && status < 400;
    String bodyCode = str(env.get("code"));
    String code = redirect ? "unexpected_status" : (bodyCode != null ? bodyCode : "http_" + status);
    String message = str(env.get("message"));
    if (message == null) {
      String snippet = text.length() > SNIPPET ? text.substring(0, SNIPPET) : text;
      message = "HTTP " + status + (text.isEmpty() ? "" : ": " + CONTROL.matcher(snippet).replaceAll(" "));
    }
    String param = str(env.get("param"));
    String type = str(env.get("type"));
    if (status == 429) {
      return new RateLimitException(message, bodyCode != null ? bodyCode : "rate_limit_exceeded", status, requestId, param, type, envelope, retryAfterSeconds(headers, nowMs));
    }
    if (status >= 500) {
      return new ServerException(message, code, status, requestId, param, type, envelope, retryAfterSeconds(headers, nowMs));
    }
    if ("private_mode_field_rejected".equals(code)) {
      return new PrivateModeFieldRejectedException(message, param != null ? param : "unknown", status, requestId, type, envelope);
    }
    if (status == 401) {
      return new AuthenticationException(message, code, status, requestId, param, type, envelope);
    }
    if (status == 403) {
      return new PermissionException(message, code, status, requestId, param, type, envelope);
    }
    if (status == 404) {
      return new NotFoundException(message, code, status, requestId, param, type, envelope);
    }
    if (status == 409 && ("idempotency".equals(type) || code.startsWith("idempotency_"))) {
      return new IdempotencyException(message, code, status, requestId, param, type, envelope);
    }
    if (status == 409 && "link_locked".equals(code)) {
      return new LinkLockedException(message, code, status, requestId, param, type, envelope);
    }
    if (status == 409) {
      return new ConflictException(message, code, status, requestId, param, type, envelope);
    }
    if (status >= 400) {
      return new InvalidRequestException(message, code, status, requestId, param, type, envelope);
    }
    return new ServerException(message, code, status, requestId, param, type, envelope, null);
  }

  public static ClikgateException fromBatchItem(int status, @Nullable Object error) {
    Map<String, Object> wrapper = new LinkedHashMap<>();
    wrapper.put("error", error instanceof Map ? error : new LinkedHashMap<String, Object>());
    return fromResponse(status, Collections.<String, String>emptyMap(), Json.write(wrapper), 0);
  }

  private static @Nullable String header(Map<String, String> headers, String name) {
    for (Map.Entry<String, String> e : headers.entrySet()) {
      if (e.getKey().equalsIgnoreCase(name)) {
        return e.getValue();
      }
    }
    return null;
  }

  /** {@code Retry-After} in milliseconds (delta-seconds or an HTTP-date against the SDK clock), or null. */
  public static @Nullable Long retryAfterMs(Map<String, String> headers, long nowMs) {
    String v = header(headers, "retry-after");
    if (v == null) {
      return null;
    }
    String s = v.trim();
    if (DIGITS.matcher(s).matches()) {
      try {
        return Long.parseLong(s) * 1000L;
      } catch (NumberFormatException e) {
        return null;
      }
    }
    try {
      long t = ZonedDateTime.parse(s, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli();
      return Math.max(0, t - nowMs);
    } catch (RuntimeException e) {
      return null;
    }
  }

  private static @Nullable Integer retryAfterSeconds(Map<String, String> headers, long nowMs) {
    Long ms = retryAfterMs(headers, nowMs);
    return ms == null ? null : (int) Math.ceil(ms / 1000.0);
  }

  private static @Nullable String str(@Nullable Object v) {
    return v instanceof String ? (String) v : null;
  }

  /** A local validation error (no HTTP request was made). */
  public static InvalidRequestException local(String code, String message, @Nullable String param) {
    return new InvalidRequestException(message, code, null, null, param, null, null);
  }

  /** Wrap anything thrown inside a never-throwing path. */
  public static ClikgateException wrap(Throwable t) {
    if (t instanceof ClikgateException) {
      return (ClikgateException) t;
    }
    ClikgateException e =
        t instanceof IllegalArgumentException
            ? new InvalidRequestException(String.valueOf(t.getMessage()), "invalid_value", null, null, null, null, null)
            : new ClikgateException(String.valueOf(t.getMessage()), "unexpected_error");
    e.initCause(t);
    return e;
  }
}
