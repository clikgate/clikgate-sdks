package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** 409 {@code link_locked}: destination, fallback and deep-link changes are refused. Never retried. */
public class LinkLockedException extends ConflictException {
  private static final long serialVersionUID = 1L;

  public LinkLockedException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public LinkLockedException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
