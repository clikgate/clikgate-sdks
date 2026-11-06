package com.clikgate.internal;

import com.clikgate.exception.PrivateModeFieldRejectedException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Internal: the private-mode guard (SPEC 12.2): refuse every non-allowed field before the HTTP layer sees it. */
public final class Guard {
  public static final String REDACTED = "[redacted]";
  private static final List<String> GOAL = Arrays.asList("goal", "click_id", "code", "reference", "value", "currency", "is_first", "occurred_at", "consent", "provider", "kept_by", "browser_engine", "platform");
  // label: the API accepts it in private mode only with "Allow labels in private mode" (SPEC 24)
  // hashed_*: SPEC 25; the API accepts them in private mode only while a destination matches by hashed
  // email or phone
  private static final List<String> HASHED = Arrays.asList("hashed_email", "hashed_phone_e164", "hashed_phone_digits");
  private static final List<String> GOAL_WITH_LABEL;
  private static final List<String> IDENTIFY = Arrays.asList("click_id", "app_id", "installation_id", "label");
  private static final List<String> CONVERSION;
  private static final List<String> REVERSAL = Arrays.asList("goal", "reference", "value", "external_id", "amount_minor");
  private static final List<String> PAYMENT_CONFIRMATION =
      Arrays.asList("provider", "reference", "status", "amount", "amount_minor", "currency", "occurred_at", "aliases", "click_id", "goal", "test", "refund_id", "source_plugin");

  static {
    List<String> c = new ArrayList<>(GOAL);
    c.add("external_id");
    c.addAll(HASHED);
    CONVERSION = Collections.unmodifiableList(c);
    List<String> g = new ArrayList<>(GOAL);
    g.add("label");
    g.addAll(HASHED);
    GOAL_WITH_LABEL = Collections.unmodifiableList(g);
  }

  private Guard() {}

  public static List<String> allowed(String kind) {
    if ("payment_confirmation".equals(kind)) {
      return PAYMENT_CONFIRMATION;
    }
    if ("identify".equals(kind)) {
      return IDENTIFY;
    }
    return "goal".equals(kind) ? GOAL_WITH_LABEL : "conversion".equals(kind) ? CONVERSION : REVERSAL;
  }

  /** Throw for the first refused (non-null) wire field: {@code metadata}, then {@code consent}, then alphabetical. */
  public static void check(String kind, Map<String, ?> wire) {
    List<String> allowed = allowed(kind);
    List<String> refused = new ArrayList<>();
    for (Map.Entry<String, ?> e : wire.entrySet()) {
      if (e.getValue() != null && !allowed.contains(e.getKey())) {
        refused.add(e.getKey());
      }
    }
    if (refused.isEmpty()) {
      return;
    }
    refused.sort((a, b) -> rank(a) != rank(b) ? Integer.compare(rank(a), rank(b)) : a.compareTo(b));
    String field = refused.get(0);
    throw new PrivateModeFieldRejectedException(
        "Private mode is on: the field \"" + field + "\" can't be sent. Only " + String.join(", ", allowed) + " are allowed.", field, null, null, null, null);
  }

  private static int rank(String k) {
    return "metadata".equals(k) ? 0 : "consent".equals(k) ? 1 : 2;
  }
}
