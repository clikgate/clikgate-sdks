package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The connection failed (DNS, refused, reset, TLS). Canonical name: {@code NetworkError}. */
public class ClikgateNetworkException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public ClikgateNetworkException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public ClikgateNetworkException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
