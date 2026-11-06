package com.clikgate.http;

import java.time.Duration;
import java.util.Collections;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** One HTTP attempt, as the SDK hands it to a {@link Transport}. */
public final class TransportRequest {
  private final String method;
  private final String url;
  private final Map<String, String> headers;
  private final byte @Nullable [] body;
  private final Duration timeout;

  public TransportRequest(String method, String url, Map<String, String> headers, byte @Nullable [] body, Duration timeout) {
    this.method = method;
    this.url = url;
    this.headers = Collections.unmodifiableMap(headers);
    this.body = body;
    this.timeout = timeout;
  }

  public String getMethod() {
    return method;
  }

  public String getUrl() {
    return url;
  }

  /** Request headers (Authorization, User-Agent, Accept, Content-Type, Idempotency-Key). */
  public Map<String, String> getHeaders() {
    return headers;
  }

  /** The JSON body, or null. */
  public byte @Nullable [] getBody() {
    return body;
  }

  /** The per-attempt timeout, covering connect, send and receive. */
  public Duration getTimeout() {
    return timeout;
  }
}
