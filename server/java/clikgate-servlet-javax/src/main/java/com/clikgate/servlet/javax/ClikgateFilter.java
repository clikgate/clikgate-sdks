package com.clikgate.servlet.javax;

import com.clikgate.ClickContext;
import com.clikgate.ClickIds;
import com.clikgate.Clikgate;
import java.io.IOException;
import javax.servlet.Filter;
import javax.servlet.FilterChain;
import javax.servlet.FilterConfig;
import javax.servlet.ServletException;
import javax.servlet.ServletRequest;
import javax.servlet.ServletResponse;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.jspecify.annotations.Nullable;

/**
 * Servlet filter (SPEC section 17): reads the click ID (query parameter, {@code _cg_<param>} cookie, then the
 * {@code Clikgate-Click-Id} header), exposes it as the request attribute {@code clikgate.click_id}, and keeps a click ID
 * that arrives in the query string in the first-party cookie (last click wins, like the web script), with the
 * {@code _cg_kept=s} marker so goals report {@code kept_by: server_cookie}.
 *
 * <pre>{@code
 * // programmatic registration (pass your one client so the organisation's click-ID parameter is used)
 * servletContext.addFilter("clikgate", new ClikgateFilter(clikgate)).addMappingForUrlPatterns(null, false, "/*");
 * // later, in a servlet:
 * String clickId = ClikgateFilter.clickId(request);
 * }</pre>
 *
 * <p>In {@code web.xml} the no-argument constructor uses {@code cgid}; init parameters: {@code clickIdParam},
 * {@code persist} (true), {@code days} (30), {@code domain}.
 */
public class ClikgateFilter implements Filter {
  /** The request attribute holding the click ID (a String, or absent). */
  public static final String ATTRIBUTE = "clikgate.click_id";

  private ClickIds helpers;
  private boolean persist = true;
  private double days = 30;
  private @Nullable String domain;

  /** Uses the default parameter {@code cgid} (or the {@code clickIdParam} init parameter). */
  public ClikgateFilter() {
    this.helpers = new ClickIds();
  }

  /** Uses the client's click-ID parameter (from config when not set explicitly). */
  public ClikgateFilter(Clikgate client) {
    this.helpers = client.clickIds();
  }

  /** Options: whether to persist, the cookie lifetime in days and its domain. */
  public ClikgateFilter(Clikgate client, boolean persist, double days, @Nullable String domain) {
    this(client);
    this.persist = persist;
    this.days = days;
    this.domain = domain;
  }

  @Override
  public void init(FilterConfig config) {
    String param = config.getInitParameter("clickIdParam");
    if (param != null && !param.isEmpty()) {
      String p = param;
      this.helpers = new ClickIds(() -> p);
    }
    String persistParam = config.getInitParameter("persist");
    if (persistParam != null) {
      this.persist = Boolean.parseBoolean(persistParam);
    }
    String daysParam = config.getInitParameter("days");
    if (daysParam != null) {
      this.days = Double.parseDouble(daysParam);
    }
    String domainParam = config.getInitParameter("domain");
    if (domainParam != null && !domainParam.isEmpty()) {
      this.domain = domainParam;
    }
  }

  @Override
  public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
    if (req instanceof HttpServletRequest && res instanceof HttpServletResponse) {
      HttpServletRequest request = (HttpServletRequest) req;
      HttpServletResponse response = (HttpServletResponse) res;
      String url = url(request);
      String clickId = helpers.fromRequest(url, request::getHeader);
      if (clickId != null) {
        request.setAttribute(ATTRIBUTE, clickId);
        if (persist && clickId.equals(helpers.fromQuery(url))) {
          ClickIds.CookieOptions options = ClickIds.CookieOptions.defaults().days(days).domain(domain).secure(isSecure(request));
          helpers.persist(response::addHeader, clickId, options);
        }
      }
    }
    chain.doFilter(req, res);
  }

  @Override
  public void destroy() {}

  /** The click ID the filter found for this request, or null. */
  public static @Nullable String clickId(ServletRequest request) {
    Object v = request.getAttribute(ATTRIBUTE);
    return v instanceof String ? (String) v : null;
  }

  /**
   * The visitor context for a goal (change 16): the click ID, how it was kept ({@code server_cookie},
   * {@code script_cookie}, {@code form}) and the browser engine and platform, parsed from the {@code User-Agent} in the
   * SDK (the User-Agent itself is never sent).
   *
   * <pre>{@code
   * clikgate.goal("account_opened", Goal.builder().reference("APP-55231").context(ClikgateFilter.context(clikgate, request)).build());
   * }</pre>
   */
  public static ClickContext context(Clikgate client, HttpServletRequest request) {
    return client.clickIds().context(url(request), request::getHeader);
  }

  static String url(HttpServletRequest request) {
    String q = request.getQueryString();
    return request.getRequestURI() + (q == null ? "" : "?" + q);
  }

  static boolean isSecure(HttpServletRequest request) {
    String proto = request.getHeader("X-Forwarded-Proto");
    if (proto != null && !proto.isEmpty()) {
      return "https".equalsIgnoreCase(proto.split(",")[0].trim());
    }
    return request.isSecure();
  }
}
