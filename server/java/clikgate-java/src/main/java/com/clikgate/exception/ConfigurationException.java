package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Invalid client options. Thrown by the builder, never later. */
public class ConfigurationException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public ConfigurationException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public ConfigurationException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
