package com.clikgate.spring;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code clikgate.*} properties.
 *
 * <pre>
 * clikgate.api-key=${CLIKGATE_API_KEY}
 * clikgate.send-mode=background        # or sync
 * clikgate.private-mode=auto           # auto | true | false
 * clikgate.timeout=10s
 * clikgate.cookie.days=30
 * clikgate.keep-route.enabled=true     # POST /cg/keep (off by default)
 * clikgate.identity-secret=${CLIKGATE_IDENTITY_SECRET}        # createIdentityToken(), server only
 * clikgate.identity-secrets.app_shop=${SHOP_IDENTITY_SECRET}  # several apps, by app ID
 * </pre>
 */
@ConfigurationProperties(prefix = "clikgate")
public class ClikgateProperties {
  /** Whether to create the Clikgate bean and filter. */
  private boolean enabled = true;
  /** cg_live_… or cg_test_… (default: the CLIKGATE_API_KEY environment variable). */
  private @Nullable String apiKey;
  /** Default: CLIKGATE_BASE_URL, else https://api.clikgate.com. */
  private @Nullable String baseUrl;
  /** Per-attempt timeout. */
  private Duration timeout = Duration.ofSeconds(10);
  /** Retries for network errors, timeouts, 429 and 5xx (0-10). */
  private int maxRetries = 3;
  /** background (default) or sync. */
  private String sendMode = "background";
  /** auto (default), true or false. */
  private String privateMode = "auto";
  /** The click-ID query parameter (default: from config, else cgid). */
  private @Nullable String clickIdParam;
  /** An http(s)://user:pass@host:port proxy (default: the JVM's https.proxyHost). */
  private @Nullable String proxy;
  /** Background batch size, 1-500. */
  private int batchSize = 100;
  /** Background flush interval. */
  private Duration flushInterval = Duration.ofSeconds(1);
  /** Background queue bound. */
  private int maxQueueSize = 10_000;
  /** The identity secret for createIdentityToken() (default: the CLIKGATE_IDENTITY_SECRET environment variable). */
  private @Nullable String identitySecret;
  /** Several apps' identity secrets, by app ID (default: CLIKGATE_IDENTITY_SECRETS, a JSON object). */
  private Map<String, String> identitySecrets = new LinkedHashMap<>();

  private final Cookie cookie = new Cookie();
  private final Filter filter = new Filter();
  private final KeepRoute keepRoute = new KeepRoute();

  /**
   * The {@code /cg/keep} route (change 16) for the web script's {@code data-server-endpoint="/cg/keep"}. Off unless
   * {@code clikgate.keep-route.enabled=true}. It uses {@code clikgate.cookie.days} (1-400) and
   * {@code clikgate.cookie.domain}.
   */
  public static class KeepRoute {
    /** Register the POST /cg/keep controller (servlet web applications with Spring MVC). */
    private boolean enabled = false;
    /** The path (served by the same host as the website). */
    private String path = "/cg/keep";
    /** Add Secure to both cookies (default true; false only for plain http://localhost while developing). */
    private boolean secure = true;

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public String getPath() {
      return path;
    }

    public void setPath(String path) {
      this.path = path;
    }

    public boolean isSecure() {
      return secure;
    }

    public void setSecure(boolean secure) {
      this.secure = secure;
    }
  }

  /** The click-ID cookie the filter writes. */
  public static class Cookie {
    /** Write the cookie when the click ID arrives in the query string. */
    private boolean persist = true;
    /** Lifetime in days. */
    private double days = 30;
    /** Cookie domain, e.g. .example.com. */
    private @Nullable String domain;

    public boolean isPersist() {
      return persist;
    }

    public void setPersist(boolean persist) {
      this.persist = persist;
    }

    public double getDays() {
      return days;
    }

    public void setDays(double days) {
      this.days = days;
    }

    public @Nullable String getDomain() {
      return domain;
    }

    public void setDomain(@Nullable String domain) {
      this.domain = domain;
    }
  }

  /** The servlet filter. */
  public static class Filter {
    /** Register the click-ID filter in servlet web applications. */
    private boolean enabled = true;
    /** Filter order. */
    private int order = -100;

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public int getOrder() {
      return order;
    }

    public void setOrder(int order) {
      this.order = order;
    }
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public @Nullable String getIdentitySecret() {
    return identitySecret;
  }

  public void setIdentitySecret(@Nullable String identitySecret) {
    this.identitySecret = identitySecret;
  }

  public Map<String, String> getIdentitySecrets() {
    return identitySecrets;
  }

  public void setIdentitySecrets(Map<String, String> identitySecrets) {
    this.identitySecrets = identitySecrets;
  }

  public @Nullable String getApiKey() {
    return apiKey;
  }

  public void setApiKey(@Nullable String apiKey) {
    this.apiKey = apiKey;
  }

  public @Nullable String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(@Nullable String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public Duration getTimeout() {
    return timeout;
  }

  public void setTimeout(Duration timeout) {
    this.timeout = timeout;
  }

  public int getMaxRetries() {
    return maxRetries;
  }

  public void setMaxRetries(int maxRetries) {
    this.maxRetries = maxRetries;
  }

  public String getSendMode() {
    return sendMode;
  }

  public void setSendMode(String sendMode) {
    this.sendMode = sendMode;
  }

  public String getPrivateMode() {
    return privateMode;
  }

  public void setPrivateMode(String privateMode) {
    this.privateMode = privateMode;
  }

  public @Nullable String getClickIdParam() {
    return clickIdParam;
  }

  public void setClickIdParam(@Nullable String clickIdParam) {
    this.clickIdParam = clickIdParam;
  }

  public @Nullable String getProxy() {
    return proxy;
  }

  public void setProxy(@Nullable String proxy) {
    this.proxy = proxy;
  }

  public int getBatchSize() {
    return batchSize;
  }

  public void setBatchSize(int batchSize) {
    this.batchSize = batchSize;
  }

  public Duration getFlushInterval() {
    return flushInterval;
  }

  public void setFlushInterval(Duration flushInterval) {
    this.flushInterval = flushInterval;
  }

  public int getMaxQueueSize() {
    return maxQueueSize;
  }

  public void setMaxQueueSize(int maxQueueSize) {
    this.maxQueueSize = maxQueueSize;
  }

  public Cookie getCookie() {
    return cookie;
  }

  public KeepRoute getKeepRoute() {
    return keepRoute;
  }

  public Filter getFilter() {
    return filter;
  }
}
