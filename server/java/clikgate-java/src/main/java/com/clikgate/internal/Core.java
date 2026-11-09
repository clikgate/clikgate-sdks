package com.clikgate.internal;

import com.clikgate.ClikgateLogger;
import com.clikgate.ErrorContext;
import com.clikgate.OnError;
import com.clikgate.PrivateMode;
import com.clikgate.Version;
import com.clikgate.exception.ClikgateException;
import com.clikgate.model.ServerSdkConfig;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.jspecify.annotations.Nullable;

/**
 * Internal: state shared by the resources of one client: logging, {@code onError}, redaction, and the server SDK
 * config ({@code GET /v1/server-sdk/config}: single attempt, 10-minute cache, fail closed, 60 s negative cache).
 * Thread-safe; concurrent callers share one in-flight config request.
 */
public final class Core {
  static final long CONFIG_TTL_MS = 600_000;
  static final long CONFIG_RETRY_MS = 60_000;

  public final Requester requester;
  public final ClikgateLogger logger;
  public final PrivateMode privateMode;
  private final @Nullable OnError onError;
  private final Set<String> warned = ConcurrentHashMap.newKeySet();
  private final Object configLock = new Object();
  private volatile @Nullable ServerSdkConfig config;
  private volatile long fetchedAt;
  private volatile @Nullable Long failedAt;
  private volatile boolean versionWarned;

  public Core(Requester requester, ClikgateLogger logger, PrivateMode privateMode, @Nullable OnError onError) {
    this.requester = requester;
    this.logger = logger;
    this.privateMode = privateMode;
    this.onError = onError;
  }

  /** The API's reason (and error code) for a goal name that isn't set up, while only set-up goals are accepted. */
  public static final String UNKNOWN_GOAL = "unknown_goal";

  /**
   * A goal the API refused because the organisation accepts only goals it has set up ({@code unknown_goal}): one
   * debug-level line, shown only when debug logging is on. The goal name only: never the reference, customer ID,
   * values or labels. The SDK never checks names itself and never remembers the refusal. Never throws.
   */
  public void noteRefusedGoal(@Nullable Object goal, @Nullable Object codeOrReason) {
    if (!UNKNOWN_GOAL.equals(codeOrReason) || !(goal instanceof String)) {
      return;
    }
    try {
      logger.debug(UNKNOWN_GOAL, "Goal `" + goal + "` isn't set up in Clikgate");
    } catch (RuntimeException ignored) {
      // a broken logger must not break the caller
    }
  }

  /** {@link #noteRefusedGoal} for each item of a batch result ({@code wires.get(i)} is the event sent at index i). */
  public void noteRefusedItems(List<? extends Map<String, Object>> wires, @Nullable Object data) {
    Object items = data instanceof Map ? ((Map<?, ?>) data).get("data") : null;
    if (!(items instanceof List)) {
      return;
    }
    for (Object o : (List<?>) items) {
      if (!(o instanceof Map)) {
        continue;
      }
      Map<?, ?> item = (Map<?, ?>) o;
      Object index = item.get("index");
      if (!(index instanceof Number) || ((Number) index).intValue() < 0 || ((Number) index).intValue() >= wires.size()) {
        continue;
      }
      Object detail = Boolean.TRUE.equals(item.get("ok")) ? item.get("goal_event") : item.get("error");
      Object reason = detail instanceof Map ? ((Map<?, ?>) detail).get(Boolean.TRUE.equals(item.get("ok")) ? "reason" : "code") : null;
      noteRefusedGoal(wires.get(((Number) index).intValue()).get("goal"), reason);
    }
  }

  /** Warn with a stable code. With {@code onceKey}, at most once per client for that key. */
  public void warn(String code, String message, @Nullable String onceKey) {
    if (onceKey != null && !warned.add(code + ":" + onceKey)) {
      return;
    }
    try {
      logger.warn(code, message);
    } catch (RuntimeException ignored) {
      // a broken logger must not break the caller
    }
  }

  public @Nullable ServerSdkConfig peekConfig() {
    return config;
  }

  private @Nullable ServerSdkConfig cached(long now, boolean[] hit) {
    ServerSdkConfig c = config;
    if (c != null && now - fetchedAt < CONFIG_TTL_MS) {
      hit[0] = true;
      return c;
    }
    Long f = failedAt;
    if (f != null && now - f < CONFIG_RETRY_MS) {
      hit[0] = true;
      return null;
    }
    return null;
  }

  /** The config, fetched when the cache is empty or stale; null when unavailable. */
  public @Nullable ServerSdkConfig config() {
    boolean[] hit = {false};
    ServerSdkConfig c = cached(requester.clock().nowMillis(), hit);
    if (hit[0]) {
      return c;
    }
    synchronized (configLock) {
      hit[0] = false;
      c = cached(requester.clock().nowMillis(), hit);
      if (hit[0]) {
        return c;
      }
      try {
        Duration t = requester.timeout().compareTo(Duration.ofSeconds(5)) < 0 ? requester.timeout() : Duration.ofSeconds(5);
        Object data = requester.request(new ApiRequest("GET", "/v1/server-sdk/config").maxRetries(0).timeout(t)).data;
        if (!(data instanceof Map) || !(((Map<?, ?>) data).get("private_mode") instanceof Boolean)) {
          throw new IllegalStateException("unexpected config body");
        }
        @SuppressWarnings("unchecked")
        ServerSdkConfig loaded = new ServerSdkConfig((Map<String, ?>) data);
        config = loaded;
        fetchedAt = requester.clock().nowMillis();
        failedAt = null;
        String minimum = loaded.minimumVersion("java");
        if (!versionWarned && minimum != null && semverLess(Version.VERSION, minimum)) {
          versionWarned = true;
          warn("sdk_below_minimum_version", "clikgate-java " + Version.VERSION + " is below the minimum version " + minimum + " for your organisation. Please upgrade.", null);
        }
        return loaded;
      } catch (RuntimeException e) {
        config = null;
        failedAt = requester.clock().nowMillis();
        String why = e instanceof ClikgateException ? ((ClikgateException) e).getCode() : "error";
        warn("config_unavailable", "Could not load the server SDK config (" + why + "); the private-mode guard stays on until it loads.", null);
        return null;
      }
    }
  }

  /** The guard state. */
  public static final class GuardState {
    public final boolean guard;
    public final @Nullable ServerSdkConfig config;

    public GuardState(boolean guard, @Nullable ServerSdkConfig config) {
      this.guard = guard;
      this.config = config;
    }
  }

  public GuardState guardState() {
    if (privateMode == PrivateMode.ON) {
      return new GuardState(true, null);
    }
    if (privateMode == PrivateMode.OFF) {
      return new GuardState(false, null);
    }
    ServerSdkConfig c = config();
    return new GuardState(c == null || c.isPrivateMode(), c);
  }

  /** Whether the guard is (or may be) on right now, without fetching: used for redaction. */
  public boolean mayBePrivate() {
    if (privateMode != PrivateMode.AUTO) {
      return privateMode == PrivateMode.ON;
    }
    ServerSdkConfig c = config;
    return c == null || c.isPrivateMode();
  }

  public String shownReference(@Nullable Object reference) {
    if (mayBePrivate()) {
      return Guard.REDACTED;
    }
    return reference == null ? "" : String.valueOf(reference);
  }

  /** Log at error level and call {@code onError}. Never throws. */
  public void report(ClikgateException error, ErrorContext context) {
    try {
      StringBuilder who = new StringBuilder();
      for (Map<String, String> e : context.getEvents()) {
        who.append(who.length() == 0 ? "" : ", ").append(e.get("goal")).append(':').append(e.get("reference"));
      }
      logger.error(
          error.getCode(),
          "Clikgate " + context.getOperation() + " failed (" + canonical(error) + " " + error.getCode() + (error.getRequestId() != null ? ", request " + error.getRequestId() : "")
              + ") for " + (who.length() == 0 ? "no events" : who) + (context.isDropped() ? "; dropped" : "") + ".");
    } catch (RuntimeException ignored) {
      // a broken logger must not break the caller
    }
    if (onError == null) {
      return;
    }
    try {
      onError.accept(error, context);
    } catch (RuntimeException e) {
      try {
        logger.error("on_error_failed", "onError threw " + e.getClass().getSimpleName() + ".");
      } catch (RuntimeException ignored) {
        // ignore
      }
    }
  }

  /** The canonical (Node) class name of an SDK exception (SPEC section 2). */
  public static String canonical(Throwable e) {
    String n = e.getClass().getSimpleName();
    if ("ClikgateTimeoutException".equals(n)) {
      return "TimeoutError";
    }
    if ("ClikgateNetworkException".equals(n)) {
      return "NetworkError";
    }
    if ("ClikgateException".equals(n)) {
      return "ClikgateError";
    }
    return e instanceof ClikgateException && n.endsWith("Exception") ? n.substring(0, n.length() - "Exception".length()) + "Error" : n;
  }

  static boolean semverLess(String a, String b) {
    int[] x = parse(a);
    int[] y = parse(b);
    for (int i = 0; i < 3; i++) {
      if (x[i] != y[i]) {
        return x[i] < y[i];
      }
    }
    return false;
  }

  private static int[] parse(String v) {
    String core = v.split("[-+]", 2)[0];
    String[] parts = core.split("\\.");
    int[] out = new int[3];
    for (int i = 0; i < 3 && i < parts.length; i++) {
      java.util.regex.Matcher m = java.util.regex.Pattern.compile("^[0-9]+").matcher(parts[i]);
      out[i] = m.find() ? Integer.parseInt(m.group()) : 0;
    }
    return out;
  }
}
