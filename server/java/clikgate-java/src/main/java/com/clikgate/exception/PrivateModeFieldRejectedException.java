package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Private mode refused a field (locally, before sending, or by the API). Carries the field <b>name</b> only. */
public class PrivateModeFieldRejectedException extends InvalidRequestException {
  private static final long serialVersionUID = 1L;

  private final String field;

  public PrivateModeFieldRejectedException(String message, String field, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, "private_mode_field_rejected", httpStatus, requestId, field, type, raw);
    this.field = field;
  }

  /** The refused field name, e.g. {@code metadata}. Never its value. */
  public String getField() {
    return field;
  }
}
