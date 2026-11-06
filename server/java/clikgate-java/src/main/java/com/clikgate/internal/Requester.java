package com.clikgate.internal;

import com.clikgate.exception.ClikgateException;
import com.clikgate.exception.ClikgateNetworkException;
import com.clikgate.exception.ClikgateTimeoutException;
import com.clikgate.exception.RateLimitException;
import com.clikgate.exception.ServerException;
import com.clikgate.http.Clock;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.math.BigDecimal;
import java.net.SocketTimeoutException;
import java.net.URLEncoder;
import java.time.Duration;
import java.time.temporal.TemporalAccessor;
import java.util.Arrays;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.DoubleSupplier;
import org.jspecify.annotations.Nullable;

/**
 * Internal: the one HTTP pipeline every call (hand-written and generated) goes through: headers, retries with
 * full-jitter backoff, {@code Retry-After}, idempotency keys and typed errors (SPEC sections 4, 6, 7).
 */
public final class Requester {
  private static final long BACKOFF_BASE_MS = 500;
  private static final long BACKOFF_CAP_MS = 20_000;
  private static final long MAX_RETRY_AFTER_MS = 60_000;
  private static final List<Integer> RETRYABLE = Arrays.asList(429, 500, 502, 503, 504);

  private final String apiKey;
  private final String baseUrl;
  private final Duration timeout;
  private final int maxRetries;
  private final String userAgent;
  private final Transport transport;
  private final Clock clock;
  private final DoubleSupplier random;

  public Requester(String apiKey, String baseUrl, Duration timeout, int maxRetries, String userAgent, Transport transport, Clock clock, DoubleSupplier random) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
    this.userAgent = userAgent;
    this.transport = transport;
    this.clock = clock;
    this.random = random;
  }

  public Clock clock() {
    return clock;
  }

  public Duration timeout() {
    return timeout;
  }

  /** Full-jitter backoff for retry number {@code n} (0-based). */
  long backoffMs(int n) {
    return (long) Math.floor(random.getAsDouble() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (1L << Math.min(n, 30))));
  }

  /** A parsed JSON response: status, body (Maps, Lists, …) and headers. */
  public static final class Result {
    public final int status;
    public final @Nullable Object data;
    public final Map<String, String> headers;

    Result(int status, @Nullable Object data, Map<String, String> headers) {
      this.status = status;
      this.data = data;
      this.headers = headers;
    }
  }

  /** Send a JSON request and parse the JSON answer (null for an empty body). */
  public Result request(ApiRequest req) {
    TransportResponse res = send(req);
    try {
      return new Result(res.getStatus(), Json.parse(res.getBody()), res.getHeaders());
    } catch (IOException e) {
      throw new ClikgateException("The API answered with a body that isn't JSON.", "invalid_response", res.getStatus(), res.header("x-request-id"), null, null, null);
    }
  }

  /** Send a request; returns the 2xx response or throws a typed exception (after retries). */
  public TransportResponse send(ApiRequest req) {
    String url = baseUrl + req.path + queryString(req.query);
    Map<String, String> headers = new LinkedHashMap<>();
    headers.put("Authorization", "Bearer " + apiKey);
    headers.put("User-Agent", userAgent);
    headers.put("Accept", "application/json");
    byte[] body = null;
    if (req.hasBody) {
      body = Json.write(req.body);
      headers.put("Content-Type", "application/json");
    }
    if ("POST".equals(req.method) || "PATCH".equals(req.method)) {
      headers.put("Idempotency-Key", req.idempotencyKey != null ? req.idempotencyKey : UUID.randomUUID().toString());
    }
    int retries = req.maxRetries != null ? req.maxRetries : maxRetries;
    Duration attemptTimeout = req.timeout != null ? req.timeout : timeout;
    TransportRequest attempt = new TransportRequest(req.method, url, headers, body, attemptTimeout);
    for (int n = 0; ; n++) {
      TransportResponse res;
      try {
        res = transport.send(attempt);
      } catch (ClikgateNetworkException | ClikgateTimeoutException e) {
        if (n >= retries) {
          throw e;
        }
        sleep(backoffMs(n));
        continue;
      } catch (SocketTimeoutException e) {
        if (n >= retries) {
          throw new ClikgateTimeoutException("The request timed out after " + attemptTimeout.toMillis() + " ms.", "timeout");
        }
        sleep(backoffMs(n));
        continue;
      } catch (IOException | RuntimeException e) {
        if (n >= retries) {
          ClikgateNetworkException ne = new ClikgateNetworkException("Could not reach the Clikgate API (" + e.getClass().getSimpleName() + ").", "network_error");
          ne.initCause(e);
          throw ne;
        }
        sleep(backoffMs(n));
        continue;
      }
      int status = res.getStatus();
      if (status >= 200 && status < 300) {
        return res;
      }
      ClikgateException error = ErrorMapper.fromResponse(status, res.getHeaders(), res.getBody(), clock.nowMillis());
      if (!RETRYABLE.contains(status)) {
        throw error;
      }
      long delay = backoffMs(n);
      if (status == 429 || status == 503) {
        Long ra = ErrorMapper.retryAfterMs(res.getHeaders(), clock.nowMillis());
        if (ra != null) {
          if (ra > MAX_RETRY_AFTER_MS) {
            throw error;
          }
          delay = ra;
        }
      }
      if (n >= retries) {
        throw error;
      }
      sleep(delay);
    }
  }

  private void sleep(long ms) {
    try {
      clock.sleep(Duration.ofMillis(ms));
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new ClikgateNetworkException("Interrupted while waiting to retry.", "network_error");
    }
  }

  /** Whether the exception class is retryable at the batch level (SPEC 9.3). */
  public static boolean isRetryable(Throwable e) {
    if (e instanceof ClikgateNetworkException || e instanceof ClikgateTimeoutException || e instanceof RateLimitException) {
      return true;
    }
    return e instanceof ServerException && ((ServerException) e).getHttpStatus() != null && RETRYABLE.contains(((ServerException) e).getHttpStatus());
  }

  /** Percent-encode one path segment (RFC 3986 unreserved characters kept). */
  public static String encodePathSegment(String s) {
    return encode(s);
  }

  /** Fill {@code {name}} placeholders with encoded values (used by the generated layer). */
  public static String path(String template, Map<String, ?> params) {
    String out = template;
    for (Map.Entry<String, ?> e : params.entrySet()) {
      out = out.replace("{" + e.getKey() + "}", encode(requireId(e.getValue(), e.getKey())));
    }
    return out;
  }

  public static String requireId(@Nullable Object value, String name) {
    if (value instanceof Number) {
      return value.toString();
    }
    if (!(value instanceof String) || ((String) value).isEmpty()) {
      throw ErrorMapper.local("invalid_argument", name + " must be a non-empty string.", name);
    }
    return (String) value;
  }

  static String encode(String s) {
    try {
      return URLEncoder.encode(s, "UTF-8").replace("+", "%20").replace("*", "%2A").replace("%7E", "~");
    } catch (UnsupportedEncodingException e) {
      throw new IllegalStateException(e);
    }
  }

  static String queryString(Map<String, ?> query) {
    StringBuilder sb = new StringBuilder();
    for (Map.Entry<String, ?> e : query.entrySet()) {
      Object v = e.getValue();
      if (v instanceof Map) {
        // A map (e.g. metadata {seller_id=sel_ada}) is sent as metadata[seller_id]=sel_ada (SPEC section 21).
        for (Map.Entry<?, ?> sub : ((Map<?, ?>) v).entrySet()) {
          if (sub.getValue() != null) {
            sb.append(sb.length() == 0 ? '?' : '&').append(encode(e.getKey() + "[" + sub.getKey() + "]")).append('=').append(encode(scalar(sub.getValue())));
          }
        }
        continue;
      }
      Collection<?> items = v instanceof Collection ? (Collection<?>) v : java.util.Collections.singletonList(v);
      for (Object item : items) {
        if (item == null) {
          continue;
        }
        sb.append(sb.length() == 0 ? '?' : '&').append(encode(e.getKey())).append('=').append(encode(scalar(item)));
      }
    }
    return sb.toString();
  }

  private static String scalar(Object v) {
    if (v instanceof Boolean) {
      return ((Boolean) v) ? "true" : "false";
    }
    if (v instanceof TemporalAccessor || v instanceof Date) {
      return Dates.format(v);
    }
    if (v instanceof BigDecimal) {
      return ((BigDecimal) v).toPlainString();
    }
    return String.valueOf(v);
  }
}
