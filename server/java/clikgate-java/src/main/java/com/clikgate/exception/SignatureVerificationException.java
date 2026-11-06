package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A webhook signature did not verify: {@code missing_signature}, {@code malformed_signature}, {@code timestamp_outside_tolerance}, {@code no_matching_signature} or {@code invalid_payload}. */
public class SignatureVerificationException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public SignatureVerificationException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public SignatureVerificationException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
