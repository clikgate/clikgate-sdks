package com.clikgate.servlet.jakarta;

import com.clikgate.ClickIds;
import com.clikgate.Clikgate;
import com.clikgate.KeepRoute;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import jakarta.servlet.ServletConfig;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServlet;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.jspecify.annotations.Nullable;

/**
 * The {@code /cg/keep} route (SPEC 13.1) for the web script's {@code data-server-endpoint="/cg/keep"}:
 * sets the first-party {@code _cg_<param>} cookie and the {@code _cg_kept=s} marker from your server, so Safari (and
 * every browser on iPhone) keeps the click ID as long as you choose, up to the browser's limit, instead of up to 7
 * days.
 *
 * <p>Same-origin {@code POST} only ({@code Sec-Fetch-Site: same-origin}, else an {@code Origin} equal to the host); a
 * JSON body of at most 1 KB with matching {@code click_id} and {@code page_click_id}; {@code 204}, or {@code 400} /
 * {@code 403} / {@code 405}, always empty with {@code Cache-Control: no-store, private}; never a redirect; nothing is
 * echoed or logged. Map it on the same host as the website.
 *
 * <pre>{@code
 * servletContext.addServlet("clikgate-keep", new ClikgateKeepServlet(clikgate)).addMapping("/cg/keep");
 * }</pre>
 *
 * <p>In {@code web.xml} the no-argument constructor uses {@code cgid}; init parameters: {@code clickIdParam},
 * {@code days} (30, from 1 to 400), {@code domain}, {@code secure} (true).
 */
public class ClikgateKeepServlet extends HttpServlet {
  private static final long serialVersionUID = 1L;

  private transient ClickIds helpers;
  private transient ClickIds.CookieOptions options;
  private transient KeepRoute route;

  /** Uses the default parameter {@code cgid} (or the {@code clickIdParam} init parameter), 30 days, {@code Secure}. */
  public ClikgateKeepServlet() {
    this(new ClickIds(), ClickIds.CookieOptions.defaults());
  }

  /** Uses the client's click-ID parameter (from config when not set explicitly), 30 days, {@code Secure}. */
  public ClikgateKeepServlet(Clikgate client) {
    this(client.clickIds(), ClickIds.CookieOptions.defaults());
  }

  /**
   * With cookie options: {@code days} (1 to 400), {@code secure} (default true) and {@code domain}.
   *
   * @throws com.clikgate.exception.InvalidRequestException {@code invalid_argument} for days outside 1-400
   */
  public ClikgateKeepServlet(Clikgate client, ClickIds.CookieOptions options) {
    this(client.clickIds(), options);
  }

  private ClikgateKeepServlet(ClickIds helpers, ClickIds.CookieOptions options) {
    this.helpers = helpers;
    this.options = options;
    this.route = helpers.keepRoute(options);
  }

  @Override
  public void init(ServletConfig config) throws ServletException {
    super.init(config);
    String param = config.getInitParameter("clickIdParam");
    if (param != null && !param.isEmpty()) {
      String p = param;
      this.helpers = new ClickIds(() -> p);
    }
    String days = config.getInitParameter("days");
    if (days != null) {
      this.options = options.days(Double.parseDouble(days));
    }
    String domain = config.getInitParameter("domain");
    if (domain != null && !domain.isEmpty()) {
      this.options = options.domain(domain);
    }
    String secure = config.getInitParameter("secure");
    if (secure != null) {
      this.options = options.secure(Boolean.parseBoolean(secure));
    }
    this.route = helpers.keepRoute(options);
  }

  @Override
  protected void service(HttpServletRequest request, HttpServletResponse response) throws IOException {
    byte[] body = "POST".equalsIgnoreCase(request.getMethod()) ? read(request.getInputStream()) : new byte[0];
    KeepRoute.Response out = route.respond(request.getMethod(), request::getHeader, body);
    response.setStatus(out.getStatus());
    for (Map.Entry<String, String> h : out.getHeaders()) {
      response.addHeader(h.getKey(), h.getValue());
    }
    if (out.getStatus() != 204) {
      response.setContentLength(0);
    }
  }

  /** At most {@code MAX_BODY + 1} bytes: enough to refuse anything larger without reading it all. */
  static byte[] read(@Nullable InputStream in) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    if (in == null) {
      return buf.toByteArray();
    }
    byte[] chunk = new byte[256];
    int n;
    while (buf.size() <= KeepRoute.MAX_BODY && (n = in.read(chunk, 0, Math.min(chunk.length, KeepRoute.MAX_BODY + 1 - buf.size()))) > 0) {
      buf.write(chunk, 0, n);
    }
    return buf.toByteArray();
  }
}
