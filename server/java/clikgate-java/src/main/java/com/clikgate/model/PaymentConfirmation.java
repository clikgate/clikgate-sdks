package com.clikgate.model;

import java.math.BigDecimal;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A payment confirmation ({@code pcf_...}): the result of {@code payments().confirm(...)} and the gateway helpers. */
public final class PaymentConfirmation extends WireObject {
  public PaymentConfirmation(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  /** The payment provider: a {@link Provider} constant, or a newer one ({@link Provider#fromString(String)}). */
  public @Nullable Provider getProvider() {
    String v = string("provider");
    return v == null ? null : Provider.fromString(v);
  }

  /** The reference ({@code "h:<hex>"} in private mode). */
  public @Nullable String getReference() {
    return string("reference");
  }

  /** {@code success}, {@code partial}, {@code pending}, {@code failed}, {@code refunded} or {@code reversed}. */
  public @Nullable String getStatus() {
    return string("status");
  }

  /** The amount in normal units (exact). */
  public @Nullable BigDecimal getAmount() {
    return decimal("amount");
  }

  /** The amount in ISO 4217 minor units. */
  public @Nullable Long getAmountMinor() {
    Object v = get("amount_minor");
    return v instanceof Number ? ((Number) v).longValue() : null;
  }

  public @Nullable String getCurrency() {
    return string("currency");
  }

  /** {@code matched}, {@code waiting_for_report}, {@code counted_without_report}, {@code unattributed}, ... */
  public @Nullable String getMatchStatus() {
    return string("match_status");
  }

  /** The matched payment report ({@code prp_...}), when one matched. */
  public @Nullable String getReportId() {
    return string("report_id");
  }

  /** The goal event recorded for it ({@code cnv_...}), when counted. */
  public @Nullable String getGoalEventId() {
    return string("goal_event_id");
  }

  /** {@code true} when the same confirmation was already received. */
  public boolean isDuplicate() {
    return Boolean.TRUE.equals(bool("duplicate"));
  }
}
