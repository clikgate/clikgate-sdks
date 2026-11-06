package com.clikgate;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Dates;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Guard;
import com.clikgate.internal.PaymentExtract;
import com.clikgate.model.PaymentConfirmation;
import com.clikgate.model.Provider;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Payments confirmed by your server. Your website or app reports a payment by sending a Payment goal with
 * {@code goal()} (provider and reference, never an amount); your server confirms it <b>right after its own verification
 * with the gateway</b>, and Clikgate counts the payment goal with the confirmed amount. Never call these with data
 * from the browser or the app. The SDK never talks to a gateway and never takes a gateway key.
 *
 * <pre>{@code
 * // after your own GET https://api.paystack.co/transaction/verify/{reference}
 * JsonNode verified = paystackVerify(reference);
 * if ("success".equals(verified.path("data").path("status").asText())) {
 *   fulfilOrder(reference);
 *   clikgate.payments().fromPaystack(verified);
 * }
 * }</pre>
 */
public final class Payments {
  private static final Pattern PROVIDER = Pattern.compile("[a-z][a-z0-9_]{1,29}");
  private static final Pattern GOAL_KEY = Pattern.compile("[a-z][a-z0-9_]{1,39}");
  private static final Pattern CURRENCY = Pattern.compile("[A-Za-z]{3}");
  private static final List<String> STATUSES = Arrays.asList("success", "partial", "pending", "failed", "refunded", "reversed");

  private final Core core;

  Payments(Core core) {
    this.core = core;
  }

  /**
   * Confirm a payment your server has verified ({@code POST /v1/payments/confirmations}). Also for refunds
   * ({@code status("refunded")}, {@code amount} = the amount refunded). A repeat answers with
   * {@code isDuplicate() == true}.
   *
   * <pre>{@code
   * PaymentConfirmation c = clikgate.payments().confirm(PaymentConfirmParams.builder()
   *     .provider(Provider.PAYSTACK).reference("T_ref_001").status("success")
   *     .amount(new BigDecimal("7500.00")).currency("NGN").build());
   * System.out.println(c.getMatchStatus());
   * }</pre>
   *
   * @throws InvalidRequestException local validation ({@code invalid_provider}, {@code invalid_reference},
   *     {@code invalid_status}, {@code invalid_amount}, {@code amount_and_amount_minor}, {@code invalid_currency},
   *     {@code invalid_aliases}, {@code invalid_goal_key}) or a 4xx; {@code PrivateModeFieldRejectedException} in
   *     private mode for fields outside the allow-list
   */
  public PaymentConfirmation confirm(PaymentConfirmParams params) {
    return confirm(params, RequestOptions.NONE);
  }

  /** {@link #confirm(PaymentConfirmParams)} with per-call options (e.g. your own idempotency key). */
  public PaymentConfirmation confirm(PaymentConfirmParams params, RequestOptions options) {
    return send(wire(params), options);
  }

  // ------------------------------------------------------------------ helpers that send

  /**
   * Confirm from Paystack's verify response ({@code GET /transaction/verify/{reference}}: the whole body or its
   * {@code data}), as a {@code Map}, a Jackson {@code JsonNode} or the raw JSON text. Returns null and sends
   * nothing when the response isn't a recognisable transaction.
   *
   * <pre>{@code
   * clikgate.payments().fromPaystack(verifyResponseBody);
   * }</pre>
   */
  public @Nullable PaymentConfirmation fromPaystack(Object response) {
    return from(Provider.PAYSTACK, response, PaymentHelperOptions.NONE);
  }

  /** {@link #fromPaystack(Object)} with a goal or a click ID. */
  public @Nullable PaymentConfirmation fromPaystack(Object response, PaymentHelperOptions options) {
    return from(Provider.PAYSTACK, response, options);
  }

  /**
   * Confirm from Flutterwave's verify response ({@code GET /v3/transactions/{id}/verify} or
   * {@code verify_by_reference}).
   *
   * <pre>{@code
   * clikgate.payments().fromFlutterwave(verifyResponseBody);
   * }</pre>
   */
  public @Nullable PaymentConfirmation fromFlutterwave(Object response) {
    return from(Provider.FLUTTERWAVE, response, PaymentHelperOptions.NONE);
  }

  /** {@link #fromFlutterwave(Object)} with a goal or a click ID. */
  public @Nullable PaymentConfirmation fromFlutterwave(Object response, PaymentHelperOptions options) {
    return from(Provider.FLUTTERWAVE, response, options);
  }

  /**
   * Confirm from Monnify's transaction status response ({@code GET /api/v2/transactions/{transactionReference}}:
   * the whole body or its {@code responseBody}).
   *
   * <pre>{@code
   * clikgate.payments().fromMonnify(statusResponseBody);
   * }</pre>
   */
  public @Nullable PaymentConfirmation fromMonnify(Object response) {
    return from(Provider.MONNIFY, response, PaymentHelperOptions.NONE);
  }

  /** {@link #fromMonnify(Object)} with a goal or a click ID. */
  public @Nullable PaymentConfirmation fromMonnify(Object response, PaymentHelperOptions options) {
    return from(Provider.MONNIFY, response, options);
  }

  /**
   * Confirm from a Stripe PaymentIntent or Checkout Session object you retrieved (or took from a webhook you
   * verified). Pass the object's JSON ({@code paymentIntent.toJson()} with stripe-java), a Map or a JsonNode. A
   * session with {@code payment_status: no_payment_required} returns null and sends nothing.
   *
   * <pre>{@code
   * PaymentIntent pi = PaymentIntent.retrieve(paymentIntentId);
   * clikgate.payments().fromStripe(pi.toJson());
   * }</pre>
   */
  public @Nullable PaymentConfirmation fromStripe(Object object) {
    return from(Provider.STRIPE, object, PaymentHelperOptions.NONE);
  }

  /** {@link #fromStripe(Object)} with a goal or a click ID. */
  public @Nullable PaymentConfirmation fromStripe(Object object, PaymentHelperOptions options) {
    return from(Provider.STRIPE, object, options);
  }

  // ------------------------------------------------------------------ builders (pure)

  /**
   * The body {@link #fromPaystack(Object)} would send, or null. No request, no config, no guard.
   *
   * <pre>{@code
   * Map<String, Object> body = clikgate.payments().buildFromPaystack(verifyResponseBody);
   * }</pre>
   */
  public @Nullable Map<String, Object> buildFromPaystack(Object response) {
    return build(Provider.PAYSTACK, response, PaymentHelperOptions.NONE);
  }

  /** {@link #buildFromPaystack(Object)} with a goal or a click ID. */
  public @Nullable Map<String, Object> buildFromPaystack(Object response, PaymentHelperOptions options) {
    return build(Provider.PAYSTACK, response, options);
  }

  /** The body {@link #fromFlutterwave(Object)} would send, or null. */
  public @Nullable Map<String, Object> buildFromFlutterwave(Object response) {
    return build(Provider.FLUTTERWAVE, response, PaymentHelperOptions.NONE);
  }

  /** {@link #buildFromFlutterwave(Object)} with a goal or a click ID. */
  public @Nullable Map<String, Object> buildFromFlutterwave(Object response, PaymentHelperOptions options) {
    return build(Provider.FLUTTERWAVE, response, options);
  }

  /** The body {@link #fromMonnify(Object)} would send, or null. */
  public @Nullable Map<String, Object> buildFromMonnify(Object response) {
    return build(Provider.MONNIFY, response, PaymentHelperOptions.NONE);
  }

  /** {@link #buildFromMonnify(Object)} with a goal or a click ID. */
  public @Nullable Map<String, Object> buildFromMonnify(Object response, PaymentHelperOptions options) {
    return build(Provider.MONNIFY, response, options);
  }

  /** The body {@link #fromStripe(Object)} would send, or null. */
  public @Nullable Map<String, Object> buildFromStripe(Object object) {
    return build(Provider.STRIPE, object, PaymentHelperOptions.NONE);
  }

  /** {@link #buildFromStripe(Object)} with a goal or a click ID. */
  public @Nullable Map<String, Object> buildFromStripe(Object object, PaymentHelperOptions options) {
    return build(Provider.STRIPE, object, options);
  }

  // ------------------------------------------------------------------ internals

  private static @Nullable Map<String, Object> build(Provider gateway, @Nullable Object response, @Nullable PaymentHelperOptions options) {
    PaymentHelperOptions o = options == null ? PaymentHelperOptions.NONE : options;
    return PaymentExtract.extract(gateway.getValue(), response, o.goal, o.clickId).body;
  }

  private @Nullable PaymentConfirmation from(Provider gateway, @Nullable Object response, @Nullable PaymentHelperOptions options) {
    PaymentHelperOptions o = options == null ? PaymentHelperOptions.NONE : options;
    PaymentExtract.Outcome outcome = PaymentExtract.extract(gateway.getValue(), response, o.goal, o.clickId);
    if (outcome.body == null) {
      if (!outcome.silent) {
        core.warn("unrecognised_payment_response", "The " + gateway + " response isn't a transaction the helper recognises (no reference or an unknown status); nothing was sent.", null);
      }
      return null;
    }
    validate(outcome.body);
    return send(outcome.body, RequestOptions.NONE);
  }

  @SuppressWarnings("unchecked")
  private PaymentConfirmation send(Map<String, Object> wire, RequestOptions options) {
    if (core.guardState().guard) {
      Guard.check("payment_confirmation", wire);
    }
    Object data = core.requester.request(new ApiRequest("POST", "/v1/payments/confirmations").body(wire).options(options)).data;
    return new PaymentConfirmation(data instanceof Map ? (Map<String, ?>) data : null);
  }

  /** Validate the params and build the wire body (SPEC 22.2). */
  static Map<String, Object> wire(PaymentConfirmParams p) {
    Map<String, @Nullable Object> w = new LinkedHashMap<>();
    w.put("provider", p.provider);
    w.put("reference", p.reference);
    w.put("status", p.status);
    if (p.amount != null && p.amountMinor != null) {
      throw ErrorMapper.local("amount_and_amount_minor", "Send amount or amountMinor, not both.", "amount");
    }
    if (p.amount != null) {
      try {
        w.put("amount", Money.formatObject(p.amount));
      } catch (InvalidRequestException e) {
        throw ErrorMapper.local("invalid_amount", "amount must be a non-negative decimal in normal units, like new BigDecimal(\"7500.00\").", "amount");
      }
    }
    if (p.amountMinor != null) {
      Object m = p.amountMinor;
      boolean integral = m instanceof Long || m instanceof Integer || m instanceof Short || m instanceof Byte || m instanceof BigInteger;
      if (!integral || (m instanceof BigInteger ? ((BigInteger) m).signum() < 0 : ((Number) m).longValue() < 0)) {
        throw ErrorMapper.local("invalid_amount", "amountMinor must be a non-negative integer in ISO 4217 minor units.", "amount_minor");
      }
      w.put("amount_minor", m);
    }
    w.put("currency", p.currency);
    w.put("occurred_at", p.occurredAt == null ? null : Dates.format(p.occurredAt));
    if (p.aliases != null && !p.aliases.isEmpty()) {
      w.put("aliases", p.aliases);
    }
    w.put("click_id", p.clickId);
    w.put("goal", p.goal);
    w.put("test", p.test);
    w.putAll(p.extra);
    Map<String, Object> out = new LinkedHashMap<>();
    for (Map.Entry<String, @Nullable Object> e : w.entrySet()) {
      if (e.getValue() != null) {
        out.put(e.getKey(), e.getValue());
      }
    }
    validate(out);
    return out;
  }

  private static void validate(Map<String, Object> w) {
    Object provider = w.get("provider");
    if (!(provider instanceof String) || !PROVIDER.matcher((String) provider).matches()) {
      throw ErrorMapper.local("invalid_provider", "provider is required: a lower-case provider key such as \"paystack\" or \"stripe\".", "provider");
    }
    Object reference = w.get("reference");
    if (!(reference instanceof String) || ((String) reference).isEmpty() || ((String) reference).codePointCount(0, ((String) reference).length()) > 128) {
      throw ErrorMapper.local("invalid_reference", "reference is required: the gateway's reference, 1-128 characters.", "reference");
    }
    Object status = w.get("status");
    if (!(status instanceof String) || !STATUSES.contains(status)) {
      throw ErrorMapper.local("invalid_status", "status must be one of " + String.join(", ", STATUSES) + ".", "status");
    }
    Object currency = w.get("currency");
    if (currency != null && (!(currency instanceof String) || !CURRENCY.matcher((String) currency).matches())) {
      throw ErrorMapper.local("invalid_currency", "currency must be an ISO 4217 code, like \"NGN\".", "currency");
    }
    Object aliases = w.get("aliases");
    if (aliases != null) {
      boolean ok = aliases instanceof List && ((List<?>) aliases).size() <= 5;
      if (ok) {
        for (Object a : (List<?>) aliases) {
          ok &= a instanceof String;
        }
      }
      if (!ok) {
        throw ErrorMapper.local("invalid_aliases", "aliases takes at most 5 other references (strings) of the same payment.", "aliases");
      }
      w.put("aliases", new ArrayList<Object>((List<?>) aliases));
    }
    Object goal = w.get("goal");
    if (goal != null && (!(goal instanceof String) || !GOAL_KEY.matcher((String) goal).matches())) {
      throw ErrorMapper.local("invalid_goal_key", "Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. \"order_paid\").", "goal");
    }
  }
}
