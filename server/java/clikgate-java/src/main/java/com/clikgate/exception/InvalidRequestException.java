package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** 400, 410, 422 and other 4xx; also local validation ({@link #getHttpStatus()} is null). */
public class InvalidRequestException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public InvalidRequestException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public InvalidRequestException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }

  private @Nullable Integer index;

  /** For batch calls: the index of the event that failed local validation. */
  public @Nullable Integer getIndex() {
    return index;
  }

  /** Sets the batch index (used by the SDK). @param index the event index @return this */
  public InvalidRequestException withIndex(int index) {
    this.index = index;
    return this;
  }

  /** On {@code test_destination_not_allowed}: the allowed destination kinds. */
  public java.util.@Nullable List<String> getAllowed() {
    Object v = rawValue("allowed");
    if (!(v instanceof java.util.List)) {
      return null;
    }
    java.util.List<String> out = new java.util.ArrayList<>();
    for (Object o : (java.util.List<?>) v) {
      out.add(String.valueOf(o));
    }
    return out;
  }

  /** On {@code test_destination_not_allowed}: the docs page explaining test-link destinations. */
  public @Nullable String getDocUrl() {
    Object v = rawValue("doc_url");
    return v instanceof String ? (String) v : null;
  }
}
