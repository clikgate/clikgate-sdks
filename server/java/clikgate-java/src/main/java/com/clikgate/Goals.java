package com.clikgate;

import com.clikgate.exception.ClikgateException;
import com.clikgate.exception.InvalidRequestException;
import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Dates;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Guard;
import com.clikgate.model.GoalBatchResult;
import com.clikgate.model.GoalEvent;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Goal events: the outcomes your business cares about ({@code account_opened}, {@code loan_disbursed}, {@code order_paid}).
 * {@code goals().send} waits for the API and throws on failure; {@code clikgate.goal()} never throws.
 */
public final class Goals {
  private static final Pattern GOAL_KEY = Pattern.compile("[a-z][a-z0-9_]{1,39}");
  private static final Pattern PROVIDER = Pattern.compile("[a-z][a-z0-9_]{1,29}");
  private final Core core;

  Goals(Core core) {
    this.core = core;
  }

  static String checkKey(@Nullable String key) {
    if (key == null || !GOAL_KEY.matcher(key).matches()) {
      throw ErrorMapper.local("invalid_goal_key", "Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. \"account_opened\").", "goal");
    }
    return key;
  }

  static String checkReference(@Nullable String reference) {
    if (reference == null || reference.isEmpty() || reference.codePointCount(0, reference.length()) > 128) {
      throw ErrorMapper.local("invalid_reference", "reference is required: your own unique ID for this event, 1-128 characters.", "reference");
    }
    return reference;
  }

  static @Nullable String checkProvider(@Nullable String provider) {
    if (provider != null && !PROVIDER.matcher(provider).matches()) {
      throw ErrorMapper.local("invalid_provider", "provider must be a provider key such as \"paystack\" or \"stripe\" (lower case).", "provider");
    }
    return provider;
  }

  /** Change 16 (SPEC 9.1, 13.1): the visitor context values. */
  static final List<String> KEPT_BY = Arrays.asList("server_cookie", "script_cookie", "form", "payment_metadata", "unknown");
  static final List<String> BROWSER_ENGINES = Arrays.asList("webkit_ios", "safari_mac", "chromium", "gecko", "other");
  static final List<String> PLATFORMS = Arrays.asList("ios", "android", "macos", "windows", "linux", "other");

  static @Nullable String checkEnum(@Nullable String value, List<String> allowed, String field) {
    if (value != null && !allowed.contains(value)) {
      throw ErrorMapper.local("invalid_argument", field + " must be one of " + String.join(", ", allowed) + ".", field);
    }
    return value;
  }

  /** Validate goal options and build the wire object (SPEC 9.1 step 1). */
  static Map<String, Object> wire(@Nullable String key, @Nullable Goal g) {
    String goal = checkKey(key);
    Goal o = g == null ? Goal.builder().build() : g;
    String reference = checkReference(o.reference);
    if (o.clickId != null && o.code != null) {
      throw ErrorMapper.local("click_id_and_code", "Send either clickId or code, not both.", "code");
    }
    String provider = checkProvider(o.provider);
    Map<String, @Nullable Object> wire = new LinkedHashMap<>();
    wire.put("goal", goal);
    wire.put("reference", reference);
    wire.put("click_id", o.clickId);
    wire.put("code", o.code);
    wire.put("value", o.value == null ? null : Money.formatObject(o.value));
    wire.put("currency", o.currency);
    wire.put("provider", provider);
    wire.put("is_first", o.isFirst);
    wire.put("label", o.label);
    wire.put("kept_by", checkEnum(o.keptBy, KEPT_BY, "kept_by"));
    wire.put("browser_engine", checkEnum(o.browserEngine, BROWSER_ENGINES, "browser_engine"));
    wire.put("platform", checkEnum(o.platform, PLATFORMS, "platform"));
    wire.put("hashed_email", o.hashedEmail);
    wire.put("hashed_phone_e164", o.hashedPhoneE164);
    wire.put("hashed_phone_digits", o.hashedPhoneDigits);
    wire.put("occurred_at", o.occurredAt == null ? null : Dates.format(o.occurredAt));
    wire.put("metadata", o.metadata);
    wire.put("consent", o.consent);
    wire.putAll(o.extra);
    HashForAds.checkWire(wire);
    Map<String, Object> out = new LinkedHashMap<>();
    for (Map.Entry<String, @Nullable Object> e : wire.entrySet()) {
      if (e.getValue() != null) {
        out.put(e.getKey(), e.getValue());
      }
    }
    return out;
  }

  /** Config-based warnings (SPEC 12.3, warn-only) and the guard (12.2). */
  static void checkBeforeSend(Core core, Core.GuardState state, Map<String, Object> wire) {
    if (state.config != null && core.privateMode == PrivateMode.AUTO) {
      String key = String.valueOf(wire.get("goal"));
      Map<String, @Nullable Object> goal = null;
      for (Map<String, @Nullable Object> g : state.config.getGoals()) {
        if (key.equals(g.get("key"))) {
          goal = g;
          break;
        }
      }
      if (goal == null) {
        core.warn("unknown_goal", "The goal \"" + key + "\" isn't defined for your organisation (it will be sent; the API decides).", key);
      } else {
        if ("none".equals(goal.get("value_mode")) && wire.containsKey("value")) {
          core.warn("value_not_allowed", "The goal \"" + key + "\" takes no value.", key);
        }
        if ("required".equals(goal.get("value_mode")) && !wire.containsKey("value")) {
          core.warn("value_required", "The goal \"" + key + "\" needs a value.", key);
        }
      }
    }
    if (state.guard) {
      Guard.check("goal", wire);
    }
  }

  static ApiRequest sendRequest(Map<String, Object> wire, @Nullable RequestOptions options) {
    // A random Idempotency-Key per call (the requester's default), reused across its retries.
    return new ApiRequest("POST", "/v1/goals/events").body(wire).options(options);
  }

  /**
   * Internal: {@code POST /v1/goals/events} for one checked wire event; notes an {@code unknown_goal} refusal (a
   * debug line). Returns the answer's data.
   */
  static @Nullable Object sendWire(Core core, Map<String, Object> wire, @Nullable RequestOptions options) {
    Object data;
    try {
      data = core.requester.request(sendRequest(wire, options)).data;
    } catch (ClikgateException e) {
      core.noteRefusedGoal(wire.get("goal"), e.getCode());
      throw e;
    }
    core.noteRefusedGoal(wire.get("goal"), data instanceof Map ? ((Map<?, ?>) data).get("reason") : null);
    return data;
  }

  /**
   * Send one goal event and wait for the result. Retries are safe: each call sends a random
   * {@code Idempotency-Key}, reused across its retries, and the API ignores a second event with the
   * same goal and reference, so a resend never counts twice.
   *
   * <pre>{@code
   * GoalEvent event = clikgate.goals().send("account_opened",
   *     Goal.builder().clickId(clickId).reference("APP-55231").value(new BigDecimal("2000000")).currency("NGN").build());
   * if (event.isCounted()) System.out.println("attributed to " + event.getAttributedTo());
   * }</pre>
   *
   * @throws InvalidRequestException local validation or a 4xx ({@code PrivateModeFieldRejectedException} in private mode)
   */
  public GoalEvent send(String key, Goal goal) {
    return send(key, goal, RequestOptions.NONE);
  }

  /** {@link #send(String, Goal)} with per-call options. */
  @SuppressWarnings("unchecked")
  public GoalEvent send(String key, Goal goal, RequestOptions options) {
    Map<String, Object> wire = wire(key, goal);
    checkBeforeSend(core, core.guardState(), wire);
    Object data = sendWire(core, wire, options);
    return new GoalEvent(data instanceof Map ? (Map<String, ?>) data : null);
  }

  /**
   * Send up to 500 goal events in one request. Per-event failures are returned, not thrown.
   *
   * <pre>{@code
   * GoalBatchResult result = clikgate.goals().sendBatch(Arrays.asList(
   *     GoalBatchEvent.of("order_paid", Goal.builder().reference("ORD-1001").clickId(clickId).value("1500.50").build()),
   *     GoalBatchEvent.of("order_paid", Goal.builder().reference("ORD-1002").value("99.90").build())));
   * for (GoalBatchResult.Item item : result.getData()) if (!item.isOk()) System.out.println(item.getIndex() + " " + item.getError());
   * }</pre>
   *
   * @throws InvalidRequestException when an event fails local validation (with {@code getIndex()}), or the batch is empty or too large
   */
  public GoalBatchResult sendBatch(List<GoalBatchEvent> events) {
    return sendBatch(events, RequestOptions.NONE);
  }

  /** {@link #sendBatch(List)} with per-call options. */
  @SuppressWarnings("unchecked")
  public GoalBatchResult sendBatch(List<GoalBatchEvent> events, RequestOptions options) {
    if (events.isEmpty()) {
      throw ErrorMapper.local("batch_empty", "Send at least one event.", "events");
    }
    if (events.size() > 500) {
      throw ErrorMapper.local("batch_too_large", "A batch takes at most 500 events.", "events");
    }
    List<Map<String, Object>> wires = new ArrayList<>();
    for (int i = 0; i < events.size(); i++) {
      try {
        GoalBatchEvent e = events.get(i);
        wires.add(wire(e.goal, e.options));
      } catch (InvalidRequestException err) {
        throw err.withIndex(i);
      }
    }
    Core.GuardState state = core.guardState();
    for (int i = 0; i < wires.size(); i++) {
      try {
        checkBeforeSend(core, state, wires.get(i));
      } catch (InvalidRequestException err) {
        throw err.withIndex(i);
      }
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("events", wires);
    Object data = core.requester.request(new ApiRequest("POST", "/v1/goals/events/batch").body(body).options(options)).data;
    core.noteRefusedItems(wires, data);
    return new GoalBatchResult(data instanceof Map ? (Map<String, ?>) data : null);
  }

  /**
   * Reverse a goal event fully (a cancelled loan).
   *
   * <pre>{@code
   * clikgate.goals().reverse("loan_disbursed", "LN-2201");
   * }</pre>
   */
  public GoalEvent reverse(String key, String reference) {
    return reverseWith(key, reference, null, null, RequestOptions.NONE);
  }

  /**
   * Reverse a goal event partly (a refund, a chargeback). {@code reason} is refused in private mode.
   *
   * <pre>{@code
   * clikgate.goals().reverse("order_paid", "ORD-1001", new BigDecimal("500"), null);
   * }</pre>
   */
  public GoalEvent reverse(String key, String reference, @Nullable BigDecimal value, @Nullable String reason) {
    return reverseWith(key, reference, value, reason, RequestOptions.NONE);
  }

  /** {@link #reverse(String, String, BigDecimal, String)} with per-call options; {@code value} may be a BigDecimal, long or decimal String. */
  @SuppressWarnings("unchecked")
  public GoalEvent reverseWith(String key, String reference, @Nullable Object value, @Nullable String reason, RequestOptions options) {
    Map<String, Object> wire = new LinkedHashMap<>();
    wire.put("goal", checkKey(key));
    wire.put("reference", checkReference(reference));
    if (value != null) {
      wire.put("value", Money.formatObject(value));
    }
    if (reason != null) {
      wire.put("reason", reason);
    }
    if (core.guardState().guard) {
      Guard.check("reversal", wire);
    }
    Object data = core.requester.request(new ApiRequest("POST", "/v1/goals/events/reverse").body(wire).options(options)).data;
    return new GoalEvent(data instanceof Map ? (Map<String, ?>) data : null);
  }
}
