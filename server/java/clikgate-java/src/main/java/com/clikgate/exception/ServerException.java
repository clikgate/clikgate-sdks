package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** 5xx, or an unexpected status (redirects are never followed). */
public class ServerException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  private final @Nullable Integer retryAfter;

  public ServerException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw, @Nullable Integer retryAfter) {
    super(message, code, httpStatus, requestId, param, type, raw);
    this.retryAfter = retryAfter;
  }

  /** Seconds from {@code Retry-After}, or null. */
  public @Nullable Integer getRetryAfter() {
    return retryAfter;
  }
}
