package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * {@code createIdentityToken()} ran in an Android app ({@code android.os.Build} loads). Identity
 * tokens are signed with your identity secret, which must stay on your server. {@code code}: {@code server_only}.
 */
public class ClikgateServerOnlyException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public ClikgateServerOnlyException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public ClikgateServerOnlyException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }
}
