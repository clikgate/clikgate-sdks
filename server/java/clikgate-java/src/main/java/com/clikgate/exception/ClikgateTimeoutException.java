package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The per-attempt timeout elapsed. Canonical name: {@code TimeoutError}. */
public class ClikgateTimeoutException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public ClikgateTimeoutException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public ClikgateTimeoutException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
