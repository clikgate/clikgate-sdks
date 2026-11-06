package com.clikgate.internal;

import com.clikgate.ClickIds;
import com.clikgate.model.Provider;
import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.time.DateTimeException;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Internal: the gateway helpers' extraction rules. Reads only the
 * reference, aliases, status, amount, currency, time, test flag and {@code cg_click_id}; never customer details.
 * Amounts are exact decimals throughout.
 */
public final class PaymentExtract {
  /** What a helper found. {@code body} is null when there is nothing to send; {@code silent} suppresses the warning. */
  public static final class Outcome {
    public final @Nullable Map<String, Object> body;
    public final boolean silent;

    Outcome(@Nullable Map<String, Object> body, boolean silent) {
      this.body = body;
      this.silent = silent;
    }
  }

  private static final Outcome UNRECOGNISED = new Outcome(null, false);
  private static final Outcome NOTHING_TO_SEND = new Outcome(null, true);

  private static final Map<String, String> PAYSTACK = statuses(
      "success", "success", "failed", "failed", "abandoned", "failed", "reversed", "reversed",
      "ongoing", "pending", "pending", "pending", "processing", "pending", "queued", "pending");
  private static final Map<String, String> MONNIFY = statuses(
      "PAID", "success", "OVERPAID", "success", "PARTIALLY_PAID", "partial", "FAILED", "failed", "CANCELLED", "failed",
      "ABANDONED", "failed", "EXPIRED", "failed", "PENDING", "pending", "REVERSED", "reversed");
  private static final Map<String, String> STRIPE_PI = statuses(
      "succeeded", "success", "canceled", "failed", "processing", "pending", "requires_payment_method", "pending",
      "requires_confirmation", "pending", "requires_action", "pending", "requires_capture", "pending");
  private static final List<String> STRIPE_ZERO_DECIMAL =
      Arrays.asList("BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF");
  private static final Pattern ISO =
      Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})[T ](\\d{2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d+))?)?(Z|z|[+-]\\d{2}:?\\d{2})?$");
  private static final BigDecimal MS_THRESHOLD = new BigDecimal("100000000000");

  private PaymentExtract() {}

  private static Map<String, String> statuses(String... pairs) {
    Map<String, String> m = new HashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      m.put(pairs[i], pairs[i + 1]);
    }
    return m;
  }

  /** Run one helper ({@code paystack}, {@code flutterwave}, {@code monnify} or {@code stripe}). */
  public static Outcome extract(String gateway, @Nullable Object response, @Nullable String goal, @Nullable String clickId) {
    Object tree = tree(response);
    if (!(tree instanceof Map)) {
      return UNRECOGNISED;
    }
    Map<?, ?> root = (Map<?, ?>) tree;
    Outcome o;
    switch (gateway) {
      case "paystack":
        o = paystack(root);
        break;
      case "flutterwave":
        o = flutterwave(root);
        break;
      case "monnify":
        o = monnify(root);
        break;
      case "stripe":
        o = stripe(root);
        break;
      default:
        throw new IllegalArgumentException("unknown gateway " + gateway);
    }
    if (o.body != null) {
      if (clickId != null) {
        o.body.put("click_id", clickId);
      }
      if (goal != null) {
        o.body.put("goal", goal);
      }
    }
    return o;
  }

  // ------------------------------------------------------------------ gateways

  private static Outcome paystack(Map<?, ?> root) {
    Map<?, ?> d = root.get("data") instanceof Map ? (Map<?, ?>) root.get("data") : root;
    String reference = str(d.get("reference"));
    String s = str(d.get("status"));
    String status = s == null ? null : PAYSTACK.get(s.toLowerCase(Locale.ROOT));
    if (reference == null || status == null) {
      return UNRECOGNISED;
    }
    BigDecimal amount = amount(d.get("amount"));
    Object domain = d.get("domain");
    return body(Provider.PAYSTACK.getValue(), reference, null, status, amount == null ? null : amount.movePointLeft(2), d.get("currency"),
        firstPresent(d.get("paid_at"), d.get("paidAt"), d.get("created_at")),
        domain instanceof String ? "test".equals(domain) : null, click(d.get("metadata")));
  }

  private static Outcome flutterwave(Map<?, ?> root) {
    Map<?, ?> d = root.get("data") instanceof Map ? (Map<?, ?>) root.get("data") : root;
    String reference = str(d.get("tx_ref"));
    if (reference == null) {
      reference = str(d.get("reference"));
    }
    if (reference == null) {
      return UNRECOGNISED;
    }
    String s = str(d.get("status"));
    String lower = s == null ? "" : s.toLowerCase(Locale.ROOT);
    String status = "successful".equals(lower) || "succeeded".equals(lower) ? "success" : "failed".equals(lower) || "voided".equals(lower) ? "failed" : "pending";
    String clickId = click(d.get("meta"));
    if (clickId == null) {
      clickId = click(d.get("meta_data"));
    }
    return body(Provider.FLUTTERWAVE.getValue(), reference, Arrays.asList(d.get("id"), d.get("flw_ref")), status, amount(d.get("amount")), d.get("currency"),
        firstPresent(d.get("created_at"), d.get("created_datetime")), null, clickId);
  }

  private static Outcome monnify(Map<?, ?> root) {
    Map<?, ?> d = root.get("responseBody") instanceof Map ? (Map<?, ?>) root.get("responseBody") : root;
    if (d.get("eventData") instanceof Map) {
      d = (Map<?, ?>) d.get("eventData");
    }
    String reference = str(d.get("paymentReference"));
    String s = str(d.get("paymentStatus"));
    String status = s == null ? null : MONNIFY.get(s.toUpperCase(Locale.ROOT));
    if (reference == null || status == null) {
      return UNRECOGNISED;
    }
    Object currency = str(d.get("currency")) != null ? d.get("currency") : d.get("currencyCode");
    return body(Provider.MONNIFY.getValue(), reference, Arrays.asList(d.get("transactionReference")), status, amount(d.get("amountPaid")), currency,
        d.get("paidOn"), null, click(d.get("metaData")));
  }

  private static Outcome stripe(Map<?, ?> o) {
    String kind = str(o.get("object"));
    String currency = upper(o.get("currency"));
    Object live = o.get("livemode");
    Boolean test = live instanceof Boolean ? !((Boolean) live) : null;
    String clickId = click(o.get("metadata"));
    if ("payment_intent".equals(kind)) {
      String s = str(o.get("status"));
      String status = s == null ? null : STRIPE_PI.get(s.toLowerCase(Locale.ROOT));
      String reference = str(o.get("id"));
      if (status == null || reference == null) {
        return UNRECOGNISED;
      }
      BigDecimal received = amount(o.get("amount_received"));
      BigDecimal raw = received != null && received.signum() > 0 ? received : amount(o.get("amount"));
      return body(Provider.STRIPE.getValue(), reference, null, status, stripeAmount(raw, currency), currency, o.get("created"), test, clickId);
    }
    if ("checkout.session".equals(kind)) {
      String ps = str(o.get("payment_status"));
      String paymentStatus = ps == null ? "" : ps.toLowerCase(Locale.ROOT);
      if ("no_payment_required".equals(paymentStatus)) {
        return NOTHING_TO_SEND;
      }
      String status = "paid".equals(paymentStatus) ? "success" : "expired".equals(str(o.get("status"))) ? "failed" : "pending";
      String sessionId = str(o.get("id"));
      Object intent = o.get("payment_intent");
      String intentId = str(intent instanceof Map ? ((Map<?, ?>) intent).get("id") : intent);
      String reference = intentId != null ? intentId : sessionId;
      if (reference == null) {
        return UNRECOGNISED;
      }
      return body(Provider.STRIPE.getValue(), reference, Arrays.asList(sessionId, o.get("client_reference_id")), status,
          stripeAmount(amount(o.get("amount_total")), currency), currency, o.get("created"), test, clickId);
    }
    return UNRECOGNISED;
  }

  private static @Nullable BigDecimal stripeAmount(@Nullable BigDecimal amount, @Nullable String currency) {
    if (amount == null) {
      return null;
    }
    return currency != null && STRIPE_ZERO_DECIMAL.contains(currency) ? amount : amount.movePointLeft(2);
  }

  // ------------------------------------------------------------------ building

  private static Outcome body(String provider, String reference, @Nullable List<?> aliases, String status, @Nullable BigDecimal amount,
      @Nullable Object currency, @Nullable Object time, @Nullable Boolean test, @Nullable String clickId) {
    Map<String, Object> b = new LinkedHashMap<>();
    b.put("provider", provider);
    b.put("reference", reference);
    List<String> a = aliases(aliases, reference);
    if (!a.isEmpty()) {
      b.put("aliases", a);
    }
    b.put("status", status);
    if (amount != null && amount.signum() >= 0) {
      b.put("amount", amountString(amount));
    }
    String cur = upper(currency);
    if (cur != null) {
      b.put("currency", cur);
    }
    String occurredAt = time(time);
    if (occurredAt != null) {
      b.put("occurred_at", occurredAt);
    }
    if (test != null) {
      b.put("test", test);
    }
    if (clickId != null) {
      b.put("click_id", clickId);
    }
    return new Outcome(b, false);
  }

  private static List<String> aliases(@Nullable List<?> raw, String reference) {
    List<String> out = new ArrayList<>();
    if (raw == null) {
      return out;
    }
    for (Object o : raw) {
      String s = str(o);
      if (s != null && !s.equals(reference) && !out.contains(s) && out.size() < 5) {
        out.add(s);
      }
    }
    return out;
  }

  /** The shortest exact decimal: no exponent, no trailing fractional zeros ({@code "100.00"} → {@code "100"}). */
  public static String amountString(BigDecimal value) {
    if (value.signum() == 0) {
      return "0";
    }
    BigDecimal v = value.stripTrailingZeros();
    if (v.scale() < 0) {
      v = v.setScale(0);
    }
    return v.toPlainString();
  }

  // ------------------------------------------------------------------ values

  private static @Nullable Object firstPresent(@Nullable Object... values) {
    for (Object v : values) {
      if (v != null && !(v instanceof String && ((String) v).trim().isEmpty())) {
        return v;
      }
    }
    return null;
  }

  /** A trimmed string (null when absent or empty); integral numbers as their digits. */
  static @Nullable String str(@Nullable Object v) {
    if (v instanceof String) {
      String s = ((String) v).trim();
      return s.isEmpty() ? null : s;
    }
    if (v instanceof BigDecimal) {
      return amountString((BigDecimal) v);
    }
    if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte || v instanceof BigInteger) {
      return v.toString();
    }
    return null;
  }

  private static @Nullable String upper(@Nullable Object v) {
    String s = v instanceof String ? str(v) : null;
    return s == null ? null : s.toUpperCase(Locale.ROOT);
  }

  /** An exact amount from an integer, a decimal, a decimal string or a float (via its shortest text); null otherwise. */
  static @Nullable BigDecimal amount(@Nullable Object v) {
    try {
      if (v instanceof BigDecimal) {
        return (BigDecimal) v;
      }
      if (v instanceof BigInteger) {
        return new BigDecimal((BigInteger) v);
      }
      if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte) {
        return BigDecimal.valueOf(((Number) v).longValue());
      }
      if (v instanceof Double || v instanceof Float) {
        double d = ((Number) v).doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) {
          return null;
        }
        return v instanceof Float ? new BigDecimal(Float.toString((Float) v)) : BigDecimal.valueOf(d);
      }
      if (v instanceof String) {
        String s = ((String) v).trim();
        return s.isEmpty() ? null : new BigDecimal(s);
      }
    } catch (NumberFormatException e) {
      return null;
    }
    return null;
  }

  /** RFC 3339 UTC from Unix seconds (milliseconds above 10^11) or an ISO 8601 string; null otherwise. */
  static @Nullable String time(@Nullable Object v) {
    if (v instanceof Number && !(v instanceof Double && (((Double) v).isNaN() || ((Double) v).isInfinite()))) {
      BigDecimal n = amount(v);
      if (n == null) {
        return null;
      }
      BigDecimal ms = n.compareTo(MS_THRESHOLD) > 0 ? n : n.movePointRight(3);
      try {
        return Dates.format(Instant.ofEpochMilli(ms.setScale(0, java.math.RoundingMode.FLOOR).longValueExact()));
      } catch (ArithmeticException | DateTimeException e) {
        return null;
      }
    }
    if (!(v instanceof String)) {
      return null;
    }
    Matcher m = ISO.matcher(((String) v).trim());
    if (!m.matches()) {
      return null;
    }
    try {
      String frac = m.group(7) == null ? "" : m.group(7);
      int nanos = frac.isEmpty() ? 0 : Integer.parseInt((frac + "000000000").substring(0, 9));
      LocalDateTime local = LocalDateTime.of(
          Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3)),
          Integer.parseInt(m.group(4)), Integer.parseInt(m.group(5)), m.group(6) == null ? 0 : Integer.parseInt(m.group(6)), nanos);
      String zone = m.group(8);
      ZoneOffset offset = ZoneOffset.UTC;
      if (zone != null && !"Z".equalsIgnoreCase(zone)) {
        String z = zone.replace(":", "");
        int sign = z.charAt(0) == '-' ? -1 : 1;
        offset = ZoneOffset.ofHoursMinutes(sign * Integer.parseInt(z.substring(1, 3)), sign * Integer.parseInt(z.substring(3, 5)));
      }
      return Dates.format(local.toInstant(offset));
    } catch (DateTimeException | NumberFormatException e) {
      return null;
    }
  }

  /** {@code cg_click_id} of a metadata object (or JSON text of one), when it is a valid click ID. */
  static @Nullable String click(@Nullable Object meta) {
    Object m = meta instanceof String ? parse((String) meta) : meta;
    if (!(m instanceof Map)) {
      return null;
    }
    Object id = ((Map<?, ?>) m).get("cg_click_id");
    return ClickIds.isValid(id) ? (String) id : null;
  }

  // ------------------------------------------------------------------ input

  private static @Nullable Object parse(String text) {
    try {
      return Json.parse(text.getBytes(StandardCharsets.UTF_8));
    } catch (Exception e) {
      return null;
    }
  }

  /** The response as Maps, Lists, Strings, Booleans and exact numbers. */
  static @Nullable Object tree(@Nullable Object v) {
    if (v instanceof String) {
      return parse((String) v);
    }
    if (v instanceof JsonNode) {
      return node((JsonNode) v);
    }
    if (v instanceof Map) {
      Map<String, @Nullable Object> out = new LinkedHashMap<>();
      for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
        out.put(String.valueOf(e.getKey()), value(e.getValue()));
      }
      return out;
    }
    return v instanceof List ? value(v) : null;
  }

  private static @Nullable Object value(@Nullable Object v) {
    if (v instanceof JsonNode) {
      return node((JsonNode) v);
    }
    if (v instanceof Map) {
      return tree(v);
    }
    if (v instanceof List) {
      List<@Nullable Object> out = new ArrayList<>();
      for (Object o : (List<?>) v) {
        out.add(value(o));
      }
      return out;
    }
    return v;
  }

  /** A Jackson tree through its JSON text, parsed back with exact decimals (works on every Jackson 2.x). */
  private static @Nullable Object node(JsonNode n) {
    return parse(n.toString());
  }
}
