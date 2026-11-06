package com.clikgate.exception;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** 403: missing scope, role, feature or plan ({@code plan_limit_reached}, {@code test_link_limit_reached}, {@code cli_scope}, …). */
public class PermissionException extends ClikgateException {
  private static final long serialVersionUID = 1L;

  public PermissionException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message, code, httpStatus, requestId, param, type, raw);
  }

  public PermissionException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }

  /** On {@code plan_limit_reached}, {@code plan_upgrade_required} and {@code plan_feature_unavailable}: the lowest plan that allows it. */
  public @Nullable String getRequiredPlan() {
    Object v = rawValue("required_plan");
    return v instanceof String ? (String) v : null;
  }

  /** On {@code test_link_limit_reached}: the number of active test links allowed. */
  public @Nullable Integer getLimit() {
    Object v = rawValue("limit");
    return v instanceof Number ? ((Number) v).intValue() : null;
  }
}
