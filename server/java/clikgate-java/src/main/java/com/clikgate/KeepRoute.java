package com.clikgate;

import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Json;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The {@code /cg/keep} route (SPEC 13.1, change 16). The web script's {@code data-server-endpoint="/cg/keep"} posts
 * the click ID from the page URL here, and the response sets the first-party {@code _cg_<param>} cookie and the
 * {@code _cg_kept=s} marker from your own server. Safari, and every browser on iPhone, keeps a click ID saved by a
 * script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the
 * browser's limit.
 *
 * <ul>
 *   <li>Only {@code POST} from the same origin ({@code Sec-Fetch-Site: same-origin}, else an {@code Origin} equal to
 *       the request's host and port).
 *   <li>The body is {@code {"click_id": "...", "page_click_id": "..."}}, at most 1024 bytes, both the same valid ID.
 *   <li>The cookie name comes from your configuration, never from the request.
 *   <li>Every response is empty with {@code Cache-Control: no-store, private}; never a redirect; nothing is echoed or
 *       logged.
 * </ul>
 *
 * This is the framework-neutral core: the Servlet ({@code com.clikgate.servlet.jakarta.ClikgateKeepServlet}, and its
 * {@code javax} twin) and the Spring Boot starter call {@link #respond}. Thread-safe.
 */
public final class KeepRoute {
  /** The largest body read: 1024 bytes. Adapters read at most {@code MAX_BODY + 1} bytes. */
  public static final int MAX_BODY = 1024;
  /** Sent on every response. */
  public static final String CACHE_CONTROL = "no-store, private";

  private final ClickIds clickIds;
  private final ClickIds.CookieOptions options;

  KeepRoute(ClickIds clickIds, ClickIds.CookieOptions options) {
    double days = options.days;
    if (Double.isNaN(days) || days != Math.floor(days) || days < 1 || days > 400) {
      throw ErrorMapper.local("invalid_argument", "days must be a whole number from 1 to 400 (browsers cap cookie lifetimes at 400 days).", "days");
    }
    this.clickIds = clickIds;
    this.options = options;
  }

  /** What to send: the status and the headers in order (the body is always empty). */
  public static final class Response {
    private final int status;
    private final List<Map.Entry<String, String>> headers;

    Response(int status, List<Map.Entry<String, String>> headers) {
      this.status = status;
      this.headers = Collections.unmodifiableList(headers);
    }

    /** 204, 400, 403 or 405. */
    public int getStatus() {
      return status;
    }

    /** {@code Cache-Control}, then {@code Allow} (405) or the two {@code Set-Cookie} values (204), in order. */
    public List<Map.Entry<String, String>> getHeaders() {
      return headers;
    }
  }

  /**
   * Answer one request.
   *
   * @param method the HTTP method
   * @param header a case-insensitive header lookup (the first value, or null when absent)
   * @param body the request body, at most {@code MAX_BODY + 1} bytes read (more is refused anyway)
   */
  public Response respond(String method, Function<String, @Nullable String> header, byte @Nullable [] body) {
    if (!"POST".equalsIgnoreCase(method)) {
      return out(405, "Allow", "POST");
    }
    if (!sameOrigin(header.apply("Sec-Fetch-Site"), header.apply("Origin"), header.apply("X-Forwarded-Host"), header.apply("Host"))) {
      return out(403);
    }
    String id = clickId(body);
    if (id == null) {
      return out(400);
    }
    return out(204, "Set-Cookie", clickIds.cookieHeader(id, options), "Set-Cookie", clickIds.markerHeader(options));
  }

  private static boolean sameOrigin(@Nullable String fetchSite, @Nullable String origin, @Nullable String forwardedHost, @Nullable String host) {
    if (fetchSite != null) {
      return "same-origin".equals(fetchSite.trim().toLowerCase(Locale.ROOT));
    }
    if (origin == null) {
      return false;
    }
    String h = forwardedHost != null && !forwardedHost.trim().isEmpty() ? forwardedHost.split(",", -1)[0].trim() : host == null ? "" : host.trim();
    if (h.isEmpty()) {
      return false;
    }
    String o = origin.trim().toLowerCase(Locale.ROOT);
    h = h.toLowerCase(Locale.ROOT);
    return o.equals("https://" + h) || o.equals("http://" + h);
  }

  private static @Nullable String clickId(byte @Nullable [] body) {
    if (body == null || body.length == 0 || body.length > MAX_BODY) {
      return null;
    }
    Object data;
    try {
      data = Json.parse(body);
    } catch (Exception e) {
      return null;
    }
    if (!(data instanceof Map)) {
      return null;
    }
    Object id = ((Map<?, ?>) data).get("click_id");
    Object page = ((Map<?, ?>) data).get("page_click_id");
    return ClickIds.isValid(id) && id.equals(page) ? (String) id : null;
  }

  private static Map.Entry<String, String> entry(String name, String value) {
    return new AbstractMap.SimpleImmutableEntry<>(name, value);
  }

  private static Response out(int status, String... extra) {
    List<Map.Entry<String, String>> headers = new ArrayList<>();
    headers.add(entry("Cache-Control", CACHE_CONTROL));
    for (int i = 0; i + 1 < extra.length; i += 2) {
      headers.add(entry(extra[i], extra[i + 1]));
    }
    return new Response(status, headers);
  }
}
