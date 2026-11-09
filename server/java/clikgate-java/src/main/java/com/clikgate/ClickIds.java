package com.clikgate;

import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Json;
import java.io.UnsupportedEncodingException;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Click IDs (SPEC section 13): read them from requests, keep them in the web script's first-party cookie, and find
 * them in payment providers' payloads. Framework-neutral: the Servlet filters and the Spring Boot starter build on it.
 */
public final class ClickIds {
  /** A prefixed ULID: {@code clk_} + 26 uppercase Crockford characters. */
  public static final Pattern PATTERN = Pattern.compile("clk_[0-9A-Z]{26}");
  /** The header a caller (your mobile app or BFF) can use to pass the click ID. */
  public static final String HEADER = "Clikgate-Click-Id";
  /** The marker cookie: {@code _cg_kept=s} says your server kept the click ID ({@code kept_by: server_cookie}). */
  public static final String MARKER = "_cg_kept";
  private static final List<String> PAYMENT_KEYS = Arrays.asList("cg_click_id", "cgid", "clikgate_click_id");
  private static final List<String> CONTAINERS = Arrays.asList("metadata", "meta", "meta_data", "note_attributes", "attributes", "custom_attributes", "customAttributes");

  private final Supplier<String> param;

  /** Helpers with the default parameter, {@code cgid}. Prefer {@code clikgate.clickIds()}, which knows your organisation's. */
  public ClickIds() {
    this(() -> "cgid");
  }

  public ClickIds(Supplier<String> param) {
    this.param = param;
  }

  /** The query parameter in use. */
  public String getParamName() {
    return param.get();
  }

  /** {@code _cg_<param>}: the same first-party cookie the web script writes. */
  public String getCookieName() {
    return "_cg_" + param.get();
  }

  /**
   * True when {@code id} is a Clikgate click ID.
   *
   * <pre>{@code
   * ClickIds.isValid("clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"); // true
   * }</pre>
   */
  public static boolean isValid(@Nullable Object id) {
    return id instanceof String && PATTERN.matcher((String) id).matches();
  }

  /**
   * Read the click ID: the query parameter, then the {@code _cg_<param>} cookie, then the {@code Clikgate-Click-Id}
   * header. Only valid IDs are returned.
   *
   * <pre>{@code
   * String clickId = clikgate.clickIds().fromRequest(request.getRequestURI() + "?" + request.getQueryString(), request::getHeader);
   * }</pre>
   *
   * @param url the URL or path with its query string
   * @param header a case-insensitive header lookup (null when absent)
   */
  public @Nullable String fromRequest(@Nullable String url, Function<String, @Nullable String> header) {
    return locate(url, header)[0];
  }

  /** The click ID and where it came from: {@code query}, {@code cookie} or {@code header}. */
  private @Nullable String[] locate(@Nullable String url, Function<String, @Nullable String> header) {
    for (String v : queryValues(url, getParamName())) {
      if (isValid(v)) {
        return new @Nullable String[] {v, "query"};
      }
    }
    for (String v : cookieValues(header.apply("Cookie"), getCookieName())) {
      if (isValid(v)) {
        return new @Nullable String[] {v, "cookie"};
      }
    }
    String h = header.apply(HEADER);
    h = h == null ? null : h.trim();
    return isValid(h) ? new @Nullable String[] {h, "header"} : new @Nullable String[] {null, null};
  }

  /**
   * The visitor context for a goal (SPEC 13.1): the click ID, how it was kept and the browser engine and platform,
   * parsed from the {@code User-Agent} here in the SDK (the User-Agent itself is never sent).
   *
   * <pre>{@code
   * ClickContext ctx = clikgate.clickIds().context(url, request::getHeader);
   * clikgate.goal("account_opened", Goal.builder().reference("APP-55231").context(ctx).build());
   * }</pre>
   *
   * @param url the URL or path with its query string
   * @param header a case-insensitive header lookup (null when absent)
   */
  public ClickContext context(@Nullable String url, Function<String, @Nullable String> header) {
    @Nullable String[] found = locate(url, header);
    String keptBy = null;
    if ("cookie".equals(found[1])) {
      keptBy = cookieValues(header.apply("Cookie"), MARKER).contains("s") ? "server_cookie" : "script_cookie";
    } else if ("header".equals(found[1])) {
      keptBy = "form";
    }
    String ua = header.apply("User-Agent");
    return new ClickContext(found[0], keptBy, browserEngine(ua), platform(ua));
  }

  /** {@link #context(String, Function)} with a header map (names in any case; list values allowed). */
  public ClickContext context(@Nullable String url, Map<String, ?> headers) {
    return context(url, name -> headerValue(headers, name));
  }

  /** The browser engine from a {@code User-Agent} (SPEC 13.1): {@code webkit_ios}, {@code gecko}, {@code chromium}, {@code safari_mac} or {@code other}. */
  public static String browserEngine(@Nullable String userAgent) {
    String ua = userAgent == null ? "" : userAgent;
    if (any(ua, "iPhone", "iPad", "iPod")) {
      return "webkit_ios";
    }
    if (ua.contains("Firefox/")) {
      return "gecko";
    }
    if (any(ua, "Chrome/", "Chromium/", "Edg/", "OPR/", "SamsungBrowser/")) {
      return "chromium";
    }
    if (ua.contains("Macintosh") && ua.contains("Safari/") && ua.contains("Version/")) {
      return "safari_mac";
    }
    return "other";
  }

  /** The platform from a {@code User-Agent} (SPEC 13.1): {@code ios}, {@code android}, {@code macos}, {@code windows}, {@code linux} or {@code other}. */
  public static String platform(@Nullable String userAgent) {
    String ua = userAgent == null ? "" : userAgent;
    if (any(ua, "iPhone", "iPad", "iPod")) {
      return "ios";
    }
    if (ua.contains("Android")) {
      return "android";
    }
    if (any(ua, "Macintosh", "Mac OS X")) {
      return "macos";
    }
    if (ua.contains("Windows")) {
      return "windows";
    }
    if (any(ua, "Linux", "X11")) {
      return "linux";
    }
    return "other";
  }

  private static boolean any(String haystack, String... needles) {
    for (String n : needles) {
      if (haystack.contains(n)) {
        return true;
      }
    }
    return false;
  }

  /**
   * The {@code /cg/keep} route (SPEC 13.1) for the web script's {@code data-server-endpoint="/cg/keep"}: the
   * framework-neutral core the Servlet ({@code ClikgateKeepServlet}) and the Spring Boot starter call. {@code secure}
   * defaults to true; {@code days} must be a whole number from 1 to 400.
   *
   * @throws com.clikgate.exception.InvalidRequestException {@code invalid_argument} for days outside 1-400
   */
  public KeepRoute keepRoute(CookieOptions options) {
    return new KeepRoute(this, options);
  }

  /** {@link #keepRoute(CookieOptions)} with 30 days, {@code Secure} and no domain. */
  public KeepRoute keepRoute() {
    return keepRoute(CookieOptions.defaults());
  }

  /** {@link #fromRequest(String, Function)} with a header map (names in any case; list values allowed). */
  public @Nullable String fromRequest(@Nullable String url, Map<String, ?> headers) {
    return fromRequest(url, name -> headerValue(headers, name));
  }

  /** The first valid click ID in the query string only (the add-ons persist only those). */
  public @Nullable String fromQuery(@Nullable String url) {
    for (String v : queryValues(url, getParamName())) {
      if (isValid(v)) {
        return v;
      }
    }
    return null;
  }

  /** Cookie options: {@code days} (30), {@code secure} (true), {@code domain}. */
  public static final class CookieOptions {
    final double days;
    final boolean secure;
    final @Nullable String domain;

    private CookieOptions(double days, boolean secure, @Nullable String domain) {
      this.days = days;
      this.secure = secure;
      this.domain = domain;
    }

    public static CookieOptions defaults() {
      return new CookieOptions(30, true, null);
    }

    public CookieOptions days(double days) {
      return new CookieOptions(days, secure, domain);
    }

    public CookieOptions secure(boolean secure) {
      return new CookieOptions(days, secure, domain);
    }

    public CookieOptions domain(@Nullable String domain) {
      return new CookieOptions(days, secure, domain);
    }
  }

  /**
   * The {@code Set-Cookie} value that keeps the click ID: {@code SameSite=Lax}, {@code Secure} on HTTPS, not
   * {@code HttpOnly} (the web script reads it).
   *
   * <pre>{@code
   * clikgate.clickIds().cookieHeader(clickId, CookieOptions.defaults());
   * // "_cg_cgid=clk_…; Path=/; Max-Age=2592000; SameSite=Lax; Secure"
   * }</pre>
   */
  public String cookieHeader(String clickId, CookieOptions options) {
    if (!isValid(clickId)) {
      throw ErrorMapper.local("invalid_click_id", "That is not a Clikgate click ID (clk_ + 26 characters).", "click_id");
    }
    StringBuilder sb = new StringBuilder();
    sb.append(getCookieName()).append('=').append(clickId).append("; Path=/; Max-Age=").append(Math.round(options.days * 86400));
    if (options.domain != null && !options.domain.isEmpty()) {
      sb.append("; Domain=").append(options.domain);
    }
    sb.append("; SameSite=Lax");
    if (options.secure) {
      sb.append("; Secure");
    }
    return sb.toString();
  }

  /**
   * Add the click-ID cookie through a header adder that appends (keeping any {@code Set-Cookie} already there),
   * e.g. {@code response::addHeader} for a Servlet response, then the {@code _cg_kept=s} marker with the same
   * attributes (so the web script reports {@code kept_by: server_cookie}).
   *
   * <pre>{@code
   * clikgate.clickIds().persist(response::addHeader, clickId, CookieOptions.defaults().secure(request.isSecure()));
   * }</pre>
   */
  public void persist(BiConsumer<String, String> addHeader, String clickId, CookieOptions options) {
    addHeader.accept("Set-Cookie", cookieHeader(clickId, options));
    addHeader.accept("Set-Cookie", markerHeader(options));
  }

  /**
   * The {@code Set-Cookie} value of the {@code _cg_kept=s} marker, with the same {@code Path}, {@code Max-Age},
   * {@code Domain}, {@code SameSite} and {@code Secure} as the click-ID cookie.
   */
  public String markerHeader(CookieOptions options) {
    StringBuilder sb = new StringBuilder();
    sb.append(MARKER).append("=s; Path=/; Max-Age=").append(Math.round(options.days * 86400));
    if (options.domain != null && !options.domain.isEmpty()) {
      sb.append("; Domain=").append(options.domain);
    }
    sb.append("; SameSite=Lax");
    if (options.secure) {
      sb.append("; Secure");
    }
    return sb.toString();
  }

  /**
   * Find the click ID in a payment provider's payload (a Map, or a JSON string): Paystack {@code metadata} (and
   * {@code custom_fields}), Flutterwave {@code meta}, Shopify note or cart attributes, WooCommerce order meta.
   *
   * <pre>{@code
   * String clickId = clikgate.clickIds().fromPaymentMetadata(rawPaystackWebhookBody);
   * }</pre>
   */
  public @Nullable String fromPaymentMetadata(@Nullable Object payload) {
    Object p = payload instanceof String ? parse((String) payload) : payload;
    if (!(p instanceof Map)) {
      return null;
    }
    List<Map<?, ?>> candidates = new ArrayList<>();
    candidates.add((Map<?, ?>) p);
    Object data = ((Map<?, ?>) p).get("data");
    if (data instanceof Map) {
      candidates.add((Map<?, ?>) data);
    }
    for (Map<?, ?> c : candidates) {
      String own = pick(c, 0);
      if (own != null) {
        return own;
      }
      for (String name : CONTAINERS) {
        Object container = c.get(name);
        if (container == null) {
          continue;
        }
        String found = pick(asMap(container), 0);
        if (found != null) {
          return found;
        }
      }
    }
    return null;
  }

  private static @Nullable Object parse(String s) {
    try {
      return Json.parse(s);
    } catch (Exception e) {
      return null;
    }
  }

  private static @Nullable Map<?, ?> asMap(@Nullable Object container) {
    Object c = container instanceof String ? parse((String) container) : container;
    if (c instanceof List) {
      Map<String, @Nullable Object> m = new LinkedHashMap<>();
      for (Object item : (List<?>) c) {
        if (!(item instanceof Map)) {
          continue;
        }
        Map<?, ?> i = (Map<?, ?>) item;
        Object k = i.get("name") != null ? i.get("name") : i.get("key") != null ? i.get("key") : i.get("variable_name") != null ? i.get("variable_name") : i.get("display_name");
        if (k instanceof String) {
          m.put((String) k, i.get("value"));
        }
      }
      return m;
    }
    return c instanceof Map ? (Map<?, ?>) c : null;
  }

  private static @Nullable String pick(@Nullable Map<?, ?> m, int depth) {
    if (m == null) {
      return null;
    }
    for (String k : PAYMENT_KEYS) {
      Object v = m.get(k);
      if (isValid(v)) {
        return (String) v;
      }
    }
    if (depth == 0 && m.get("custom_fields") instanceof List) {
      return pick(asMap(m.get("custom_fields")), 1);
    }
    return null;
  }

  private static @Nullable String headerValue(Map<String, ?> headers, String name) {
    List<String> values = new ArrayList<>();
    for (Map.Entry<String, ?> e : headers.entrySet()) {
      if (!e.getKey().equalsIgnoreCase(name)) {
        continue;
      }
      Object v = e.getValue();
      if (v instanceof Iterable) {
        for (Object o : (Iterable<?>) v) {
          values.add(String.valueOf(o));
        }
      } else if (v != null) {
        values.add(String.valueOf(v));
      }
    }
    return values.isEmpty() ? null : String.join("cookie".equals(name.toLowerCase(Locale.ROOT)) ? "; " : ", ", values);
  }

  private static List<String> queryValues(@Nullable String url, String name) {
    List<String> out = new ArrayList<>();
    if (url == null) {
      return out;
    }
    int q = url.indexOf('?');
    if (q < 0) {
      return out;
    }
    String query = url.substring(q + 1);
    int hash = query.indexOf('#');
    if (hash >= 0) {
      query = query.substring(0, hash);
    }
    for (String pair : query.split("&")) {
      if (pair.isEmpty()) {
        continue;
      }
      int eq = pair.indexOf('=');
      String k = decode(eq < 0 ? pair : pair.substring(0, eq));
      if (k.equals(name)) {
        out.add(decode(eq < 0 ? "" : pair.substring(eq + 1)));
      }
    }
    return out;
  }

  private static List<String> cookieValues(@Nullable String header, String name) {
    List<String> out = new ArrayList<>();
    if (header == null) {
      return out;
    }
    for (String part : header.split(";")) {
      int eq = part.indexOf('=');
      if (eq < 0 || !part.substring(0, eq).trim().equals(name)) {
        continue;
      }
      String v = part.substring(eq + 1).trim();
      if (v.length() >= 2 && v.startsWith("\"") && v.endsWith("\"")) {
        v = v.substring(1, v.length() - 1);
      }
      out.add(decodeComponent(v));
    }
    return out;
  }

  private static String decode(String s) {
    try {
      return URLDecoder.decode(s, "UTF-8");
    } catch (UnsupportedEncodingException | IllegalArgumentException e) {
      return s;
    }
  }

  /** decodeURIComponent: like {@link #decode} but a {@code +} stays a plus. */
  private static String decodeComponent(String s) {
    return decode(s.replace("+", "%2B"));
  }
}
