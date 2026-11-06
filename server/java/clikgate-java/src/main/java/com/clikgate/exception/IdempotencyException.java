package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** 409 {@code idempotency_*}: the key was used with a different request, or the first request is still running. */
public class IdempotencyException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public IdempotencyException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public IdempotencyException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
