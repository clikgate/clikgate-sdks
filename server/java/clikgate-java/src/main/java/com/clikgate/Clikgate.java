package com.clikgate;

import com.clikgate.api.ApiClient;
import com.clikgate.exception.ConfigurationException;
import com.clikgate.http.Clock;
import com.clikgate.http.RequestOptions;
import com.clikgate.http.SocketTransport;
import com.clikgate.http.Transport;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Guard;
import com.clikgate.internal.Requester;
import com.clikgate.internal.UserAgent;
import com.clikgate.model.PersonIdentified;
import com.clikgate.model.ServerSdkConfig;
import com.clikgate.model.WebhookEvent;
import java.net.URI;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * The Clikgate client. Create one and reuse it: it is thread-safe.
 *
 * <pre>{@code
 * Clikgate clikgate = Clikgate.fromEnv();   // reads CLIKGATE_API_KEY
 * clikgate.goal("account_opened", Goal.builder().clickId(clickId).reference("APP-55231").value(new BigDecimal("2000000")).build());
 * }</pre>
 *
 * <p>Kotlin: {@code val clikgate = Clikgate.builder().apiKey(key).build()}.
 */
public final class Clikgate implements AutoCloseable {
  private static final Pattern KEY = Pattern.compile("cg_(live|test)_[A-Za-z0-9_]+");
  private static final Pattern PARAM = Pattern.compile("[A-Za-z0-9_]{1,32}");
  private static final Duration SHUTDOWN_FLUSH = Duration.ofSeconds(5);
  private static final Set<Clikgate> CLIENTS = Collections.synchronizedSet(Collections.newSetFromMap(new WeakHashMap<Clikgate, Boolean>()));
  private static volatile boolean hookInstalled;

  private final String mode;
  private final Core core;
  private final GoalSender sender;
  private final SendMode sendMode;
  private final Goals goals;
  private final Conversions conversions;
  private final Payments payments;
  private final Links links;
  private final Clicks clicks;
  private final ClickIds clickIds;
  private final ApiClient api;
  private final Clock clock;
  private final @Nullable SocketTransport ownTransport;
  private final @Nullable String identitySecret;
  private final @Nullable Map<String, String> identitySecrets;
  private volatile boolean closed;

  private Clikgate(Builder b) {
    String apiKey = b.apiKey != null ? b.apiKey : System.getenv("CLIKGATE_API_KEY");
    if (apiKey == null || apiKey.isEmpty()) {
      throw new ConfigurationException("No API key: call apiKey(…) or set CLIKGATE_API_KEY (cg_live_… or cg_test_…).", "missing_api_key", null, null, "apiKey", null, null);
    }
    Matcher m = KEY.matcher(apiKey);
    if (!m.matches()) {
      throw new ConfigurationException("The API key is " + keyType(apiKey) + ". Server SDKs need a cg_live_… or cg_test_… API key from Developers → API keys.", "invalid_api_key", null, null, "apiKey", null, null);
    }
    this.mode = m.group(1);
    this.identitySecret = b.identitySecret;
    this.identitySecrets = b.identitySecrets == null ? null : Collections.unmodifiableMap(new LinkedHashMap<>(b.identitySecrets));
    String env = System.getenv("CLIKGATE_BASE_URL");
    String baseUrl = b.baseUrl != null ? b.baseUrl : (env != null && !env.isEmpty() ? env : "https://api.clikgate.com");
    while (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
    }
    URI uri;
    try {
      uri = URI.create(baseUrl);
    } catch (IllegalArgumentException e) {
      throw invalid("baseUrl", "baseUrl is not a URL.");
    }
    String host = uri.getHost();
    boolean local = "localhost".equals(host) || "127.0.0.1".equals(host) || "[::1]".equals(host);
    if (host == null || !("https".equals(uri.getScheme()) || ("http".equals(uri.getScheme()) && local))) {
      throw invalid("baseUrl", "baseUrl must use https:// (http:// only for localhost).");
    }
    if (b.timeout.isNegative() || b.timeout.isZero() || b.timeout.compareTo(Duration.ofMinutes(10)) > 0) {
      throw invalid("timeout", "timeout must be more than 0 and at most 10 minutes.");
    }
    range("maxRetries", b.maxRetries, 0, 10);
    range("batchSize", b.batchSize, 1, 500);
    range("maxQueueSize", b.maxQueueSize, 1, 1_000_000);
    if (b.flushInterval.isNegative() || b.flushInterval.isZero() || b.flushInterval.compareTo(Duration.ofHours(1)) > 0) {
      throw invalid("flushInterval", "flushInterval must be more than 0 and at most 1 hour.");
    }
    String clickIdParam = b.clickIdParam;
    if (clickIdParam != null && !PARAM.matcher(clickIdParam).matches()) {
      throw invalid("clickIdParam", "clickIdParam must be 1-32 letters, digits or underscores.");
    }
    Transport transport = b.transport;
    SocketTransport own = null;
    if (transport == null) {
      if (b.noProxy) {
        own = SocketTransport.noProxy();
      } else if (b.proxy != null) {
        URI p;
        try {
          p = URI.create(b.proxy);
        } catch (IllegalArgumentException e) {
          throw invalid("proxy", "proxy must be an http:// or https:// URL.");
        }
        if (!("http".equals(p.getScheme()) || "https".equals(p.getScheme())) || p.getHost() == null) {
          throw invalid("proxy", "proxy must be an http:// or https:// URL.");
        }
        own = SocketTransport.withProxy(p);
      } else {
        own = SocketTransport.systemDefault();
      }
      transport = own;
    }
    this.ownTransport = own;
    this.clock = b.clock;
    Requester requester = new Requester(apiKey, baseUrl, b.timeout, b.maxRetries, UserAgent.current(), transport, b.clock, b.random);
    this.core = new Core(requester, b.logger != null ? b.logger : ClikgateLogger.standard(), b.privateMode, b.onError);
    this.sendMode = b.sendMode;
    this.sender = new GoalSender(core, b.batchSize, b.maxQueueSize, b.flushInterval);
    this.goals = new Goals(core);
    this.conversions = new Conversions(core);
    this.payments = new Payments(core);
    this.links = new Links(core);
    this.clicks = new Clicks(core);
    Core c = core;
    this.clickIds =
        new ClickIds(
            () -> {
              if (clickIdParam != null) {
                return clickIdParam;
              }
              ServerSdkConfig cfg = c.peekConfig();
              String fromConfig = cfg == null ? null : cfg.getClickIdParam();
              return fromConfig != null ? fromConfig : "cgid";
            });
    this.api = new ApiClient(requester);
    if (b.shutdownHooks) {
      register(this);
    }
  }

  /** A client configured from the environment ({@code CLIKGATE_API_KEY}, {@code CLIKGATE_BASE_URL}). */
  public static Clikgate fromEnv() {
    return builder().build();
  }

  public static Builder builder() {
    return new Builder();
  }

  /** {@code live} or {@code test}, from the API key prefix. */
  public String mode() {
    return mode;
  }

  /** Goal events. */
  public Goals goals() {
    return goals;
  }

  /** Conversions (older API). */
  public Conversions conversions() {
    return conversions;
  }

  /**
   * Payments your server confirms right after its own verification with the gateway:
   * {@code payments().fromPaystack(verifyResponse)}, {@code fromFlutterwave}, {@code fromMonnify},
   * {@code fromStripe} and {@code confirm(...)}.
   */
  public Payments payments() {
    return payments;
  }

  /** Links. */
  public Links links() {
    return links;
  }

  /** Clicks. */
  public Clicks clicks() {
    return clicks;
  }

  /** Click-ID helpers using this client's {@code clickIdParam} (or the organisation's, from config). */
  public ClickIds clickIds() {
    return clickIds;
  }

  /** Every API-key operation, generated from openapi.json ("advanced"). */
  public ApiClient api() {
    return api;
  }

  /**
   * Record a goal without waiting. <b>Never throws</b>: failures go to the logger and {@code onError}.
   * In background mode the event is queued and a daemon thread sends it in batches.
   *
   * <pre>{@code
   * clikgate.goal("account_opened", Goal.builder().clickId(application.getClickId()).reference("APP-55231").value(2_000_000L).currency("NGN").build());
   * }</pre>
   */
  public void goal(String key, Goal goal) {
    try {
      if (closed) {
        core.report(ErrorMapper.local("client_closed", "This Clikgate client is closed.", null), new ErrorContext("goal", shown(key, goal), true));
        return;
      }
      Map<String, Object> wire;
      try {
        wire = Goals.wire(key, goal);
      } catch (RuntimeException e) {
        core.report(ErrorMapper.wrap(e), new ErrorContext("goal", shown(key, goal), true));
        return;
      }
      if (sendMode == SendMode.BACKGROUND) {
        sender.enqueue(wire);
        return;
      }
      sender.post(
          () -> {
            try {
              Goals.checkBeforeSend(core, core.guardState(), wire);
              Goals.sendWire(core, wire, null);
            } catch (RuntimeException e) {
              core.report(ErrorMapper.wrap(e), new ErrorContext("goal", shown(key, goal), true));
            }
          });
    } catch (RuntimeException ignored) {
      // goal() never throws, whatever happens
    }
  }

  private List<Map<String, String>> shown(@Nullable String key, @Nullable Goal goal) {
    Map<String, String> m = new LinkedHashMap<>();
    m.put("goal", String.valueOf(key));
    m.put("reference", core.shownReference(goal == null ? null : goal.reference));
    return Collections.singletonList(m);
  }

  /**
   * Create an identity token for the signed-in user (path A of https://clikgate.com/docs/identify-users).
   * Return it in your sign-in and "current user" responses; the app passes it to the mobile SDK's {@code identifyUser()}.
   * Uses the builder's {@code identitySecret} / {@code identitySecrets}, else {@code CLIKGATE_IDENTITY_SECRET} /
   * {@code CLIKGATE_IDENTITY_SECRETS}. No network call. Throws {@code ClikgateServerOnlyException} in an Android app.
   *
   * <pre>{@code
   * response.put("clikgateIdentityToken", clikgate.createIdentityToken(user.getId()));
   * }</pre>
   */
  public String createIdentityToken(String customerId) {
    return createIdentityToken(customerId, null);
  }

  /** {@link #createIdentityToken(String)} with that app's secret, for several apps. */
  public String createIdentityToken(String customerId, @Nullable String appId) {
    return IdentityTokens.createWith(IdentityTokens.onAndroid(), identitySecret, identitySecrets, System::getenv, customerId, appId, null, null);
  }

  /**
   * Tell Clikgate who a person is ({@code POST /v1/people/identify}): a click, an app installation ({@code appId} +
   * {@code installationId}) or your {@code customerId}, at least one. With a click or installation, {@code customerId}
   * links it to that customer. {@code label} is what your team sees instead of the click ID (1-80 characters,
   * {@code ""} clears it; Growth and up). Always verified (your server), so it also satisfies a referral program's
   * {@code require_identity_token}. In private mode {@code customerId} is refused locally and {@code label} needs
   * "Allow labels in private mode".
   *
   * <p>Path B of https://clikgate.com/docs/identify-users (no identity secret or token): the app reads
   * {@code getInstallationId()} and sends it in its sign-in request; your server calls this with {@code appId},
   * {@code installationId}, {@code customerId} and optionally {@code label}, after sign-in and at every signed-in app
   * open. When the app sends no installation ID (tracking is off), skip the call. Clikgate accepts installations active
   * in the last 7 days.
   *
   * <pre>{@code
   * clikgate.identifyUser(IdentifyUserParams.builder().clickId(clickId).customerId("user_42").label("Ada (VIP)").build());
   * if (installationId != null) {
   *   clikgate.identifyUser(IdentifyUserParams.builder().appId("app_…").installationId(installationId).customerId(user.getId()).build());
   * }
   * }</pre>
   */
  public PersonIdentified identifyUser(IdentifyUserParams params) {
    return identifyUser(params, RequestOptions.NONE);
  }

  /** {@link #identifyUser(IdentifyUserParams)} with per-call options. */
  @SuppressWarnings("unchecked")
  public PersonIdentified identifyUser(IdentifyUserParams params, RequestOptions options) {
    if ((params.appId == null) != (params.installationId == null)) {
      throw ErrorMapper.local("invalid_request", "Send appId and installationId together.", params.appId == null ? "app_id" : "installation_id");
    }
    if (params.clickId == null && params.installationId == null && params.customerId == null) {
      throw ErrorMapper.local("invalid_request", "Send clickId, appId + installationId, or customerId.", "click_id");
    }
    Map<String, Object> body = new LinkedHashMap<>();
    if (params.clickId != null) body.put("click_id", params.clickId);
    if (params.appId != null) body.put("app_id", params.appId);
    if (params.installationId != null) body.put("installation_id", params.installationId);
    if (params.customerId != null) body.put("customer_id", params.customerId);
    if (params.label != null) body.put("label", params.label);
    if (core.guardState().guard) {
      Guard.check("identify", body);
    }
    Object data = core.requester.request(new ApiRequest("POST", "/v1/people/identify").body(body).options(options)).data;
    return new PersonIdentified(data instanceof Map ? (Map<String, ?>) data : null);
  }

  /**
   * The organisation's server SDK config (private mode, click-ID parameter, goals), cached for 10 minutes; null
   * when it can't be loaded.
   *
   * <pre>{@code
   * ServerSdkConfig config = clikgate.config();
   * if (config != null && config.isPrivateMode()) System.out.println("private mode is on");
   * }</pre>
   */
  public @Nullable ServerSdkConfig config() {
    return core.config();
  }

  /** Verify a webhook with this client's clock (see {@link Webhooks}). */
  public WebhookEvent verifyWebhook(byte[] rawBody, @Nullable String signatureHeader, String secret) {
    return Webhooks.verify(rawBody, signatureHeader, secret, Webhooks.DEFAULT_TOLERANCE, clock.nowMillis() / 1000);
  }

  /**
   * Send everything queued (and wait for sends in flight). Returns true when done within 10 s. Never throws.
   *
   * <pre>{@code
   * clikgate.flush();   // e.g. at the end of a batch job or a serverless handler
   * }</pre>
   */
  public boolean flush() {
    return flush(Duration.ofSeconds(10));
  }

  /** {@link #flush()} with a timeout. */
  public boolean flush(Duration timeout) {
    try {
      return sender.flush(timeout);
    } catch (RuntimeException e) {
      return false;
    }
  }

  /** Flush, stop the sender thread and close connections. Later {@code goal()} calls go to {@code onError} ({@code client_closed}). */
  @Override
  public void close() {
    close(Duration.ofSeconds(10));
  }

  /** {@link #close()} with a flush timeout; returns whether the flush finished in time. */
  public boolean close(Duration timeout) {
    if (closed) {
      return flush(timeout);
    }
    closed = true;
    CLIENTS.remove(this);
    boolean done = flush(timeout);
    sender.stop();
    if (ownTransport != null) {
      ownTransport.closeIdle();
    }
    return done;
  }

  private static void register(Clikgate client) {
    CLIENTS.add(client);
    if (hookInstalled) {
      return;
    }
    synchronized (CLIENTS) {
      if (hookInstalled) {
        return;
      }
      hookInstalled = true;
      try {
        Runtime.getRuntime()
            .addShutdownHook(
                new Thread(
                    () -> {
                      Clikgate[] all;
                      synchronized (CLIENTS) {
                        all = CLIENTS.toArray(new Clikgate[0]);
                      }
                      for (Clikgate c : all) {
                        if (c.sender.busy()) {
                          c.flush(SHUTDOWN_FLUSH);
                        }
                      }
                    },
                    "clikgate-shutdown"));
      } catch (IllegalStateException e) {
        // the JVM is already shutting down
      }
    }
  }

  private static void range(String name, int v, int lo, int hi) {
    if (v < lo || v > hi) {
      throw invalid(name, name + " must be a number from " + lo + " to " + hi + ".");
    }
  }

  private static ConfigurationException invalid(String param, String message) {
    return new ConfigurationException(message, "invalid_option", null, null, param, null, null);
  }

  private static String keyType(String k) {
    if (k.startsWith("cg_sdk_")) {
      return "a mobile SDK key (cg_sdk_…)";
    }
    if (k.startsWith("cg_site_")) {
      return "a web script site key (cg_site_…)";
    }
    if (k.startsWith("cg_cli_")) {
      return "a setup command token (cg_cli_…)";
    }
    return "not a Clikgate server API key";
  }

  /** Builder for {@link Clikgate}. Every option is optional; validation happens in {@link #build()}. */
  public static final class Builder {
    private @Nullable String apiKey;
    private @Nullable String baseUrl;
    private Duration timeout = Duration.ofSeconds(10);
    private int maxRetries = 3;
    private SendMode sendMode = SendMode.BACKGROUND;
    private PrivateMode privateMode = PrivateMode.AUTO;
    private @Nullable String clickIdParam;
    private @Nullable ClikgateLogger logger;
    private @Nullable OnError onError;
    private @Nullable Transport transport;
    private @Nullable String proxy;
    private boolean noProxy;
    private int batchSize = 100;
    private Duration flushInterval = Duration.ofSeconds(1);
    private int maxQueueSize = 10_000;
    private boolean shutdownHooks = true;
    private @Nullable String identitySecret;
    private @Nullable Map<String, String> identitySecrets;
    private Clock clock = Clock.SYSTEM;
    private DoubleSupplier random = () -> ThreadLocalRandom.current().nextDouble();

    private Builder() {}

    /** {@code cg_live_…} or {@code cg_test_…}. Default: {@code CLIKGATE_API_KEY}. */
    public Builder apiKey(@Nullable String apiKey) {
      this.apiKey = apiKey;
      return this;
    }

    /** Default {@code CLIKGATE_BASE_URL}, else {@code https://api.clikgate.com}. */
    public Builder baseUrl(@Nullable String baseUrl) {
      this.baseUrl = baseUrl;
      return this;
    }

    /** Per-attempt timeout covering connect, TLS, send and receive (default 10 s). */
    public Builder timeout(Duration timeout) {
      this.timeout = timeout;
      return this;
    }

    /** Retries for network errors, timeouts and HTTP 429, 500, 502, 503 and 504 (default 3, at most 10). */
    public Builder maxRetries(int maxRetries) {
      this.maxRetries = maxRetries;
      return this;
    }

    /** {@link SendMode#BACKGROUND} (default) or {@link SendMode#SYNC}. */
    public Builder sendMode(SendMode sendMode) {
      this.sendMode = sendMode;
      return this;
    }

    /** {@link PrivateMode#AUTO} (default), {@link PrivateMode#ON} or {@link PrivateMode#OFF}. */
    public Builder privateMode(PrivateMode privateMode) {
      this.privateMode = privateMode;
      return this;
    }

    /** The click-ID query parameter (default: from config, else {@code cgid}). */
    public Builder clickIdParam(@Nullable String clickIdParam) {
      this.clickIdParam = clickIdParam;
      return this;
    }

    /** Where to log (default: SLF4J if present, else java.util.logging). */
    public Builder logger(ClikgateLogger logger) {
      this.logger = logger;
      return this;
    }

    /** Called for failures that can't be thrown (background sends, every {@code goal()}). */
    public Builder onError(OnError onError) {
      this.onError = onError;
      return this;
    }

    /** Your own HTTP client (mTLS, a corporate proxy library, tracing). Default: the built-in {@link SocketTransport}. */
    public Builder transport(Transport transport) {
      this.transport = transport;
      return this;
    }

    /** An {@code http(s)://[user:pass@]host:port} proxy. Default: the JVM's {@code https.proxyHost}. */
    public Builder proxy(String proxyUrl) {
      this.proxy = proxyUrl;
      this.noProxy = false;
      return this;
    }

    /** Ignore the JVM proxy settings. */
    public Builder noProxy() {
      this.noProxy = true;
      this.proxy = null;
      return this;
    }

    /** Background batch size, 1-500 (default 100). */
    public Builder batchSize(int batchSize) {
      this.batchSize = batchSize;
      return this;
    }

    /** Background flush interval (default 1 s). */
    public Builder flushInterval(Duration flushInterval) {
      this.flushInterval = flushInterval;
      return this;
    }

    /** Background queue bound (default 10,000); when full, the oldest event is dropped. */
    public Builder maxQueueSize(int maxQueueSize) {
      this.maxQueueSize = maxQueueSize;
      return this;
    }

    /** Flush on JVM shutdown (default true). */
    public Builder shutdownHooks(boolean shutdownHooks) {
      this.shutdownHooks = shutdownHooks;
      return this;
    }

    /** The identity secret for {@code createIdentityToken()}. Default: {@code CLIKGATE_IDENTITY_SECRET}. */
    public Builder identitySecret(@Nullable String identitySecret) {
      this.identitySecret = identitySecret;
      return this;
    }

    /** Several apps' identity secrets, by app ID. Default: {@code CLIKGATE_IDENTITY_SECRETS} (a JSON object). */
    public Builder identitySecrets(@Nullable Map<String, String> identitySecrets) {
      this.identitySecrets = identitySecrets;
      return this;
    }

    /** Advanced (tests): replace the clock and sleep. */
    public Builder clock(Clock clock) {
      this.clock = clock;
      return this;
    }

    /** Advanced (tests): the random source for backoff jitter, in [0, 1). */
    public Builder random(DoubleSupplier random) {
      this.random = random;
      return this;
    }

    /** @throws ConfigurationException for invalid options */
    public Clikgate build() {
      return new Clikgate(this);
    }
  }
}
