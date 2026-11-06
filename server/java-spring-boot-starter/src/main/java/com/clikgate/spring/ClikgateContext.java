package com.clikgate.spring;

import com.clikgate.servlet.jakarta.ClikgateFilter;
import org.jspecify.annotations.Nullable;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;

/**
 * The current request's click ID, anywhere in the request thread.
 *
 * <pre>{@code
 * String clickId = ClikgateContext.currentClickId();
 * }</pre>
 */
public final class ClikgateContext {
  private ClikgateContext() {}

  /** The click ID the filter found for the current request, or null (also outside a request). */
  public static @Nullable String currentClickId() {
    RequestAttributes attributes = RequestContextHolder.getRequestAttributes();
    if (attributes == null) {
      return null;
    }
    Object v = attributes.getAttribute(ClikgateFilter.ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
    return v instanceof String ? (String) v : null;
  }
}
