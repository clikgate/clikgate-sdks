package com.clikgate;

import com.clikgate.internal.Dates;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The parameters of {@link Referrals#completeStep(String, CompleteStepParams)}: the goal step your server saw
 * completed. {@code value} is in normal units: a {@code BigDecimal}, a {@code long} or a decimal string.
 *
 * <pre>{@code
 * CompleteStepParams.builder().goal("first_deposit").occurredAt(deposit.getCreatedAt()).value(new BigDecimal("15000")).currency("NGN").build();
 * }</pre>
 */
public final class CompleteStepParams {
  final @Nullable String goal;
  final @Nullable Instant occurredAt;
  final @Nullable String value;
  final @Nullable String currency;

  private CompleteStepParams(Builder b) {
    goal = b.goal;
    occurredAt = b.occurredAt;
    value = b.value;
    currency = b.currency;
  }

  public static Builder builder() {
    return new Builder();
  }

  Map<String, Object> wire() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("goal", com.clikgate.internal.Requester.requireId(goal, "goal"));
    if (occurredAt == null) {
      throw com.clikgate.internal.ErrorMapper.local("invalid_argument", "occurredAt is required: when the step's goal happened.", "occurred_at");
    }
    m.put("occurred_at", Dates.format(occurredAt));
    if (value != null) {
      m.put("value", value);
    }
    if (currency != null) {
      m.put("currency", currency);
    }
    return m;
  }

  /** Builder for {@link CompleteStepParams}. */
  public static final class Builder {
    private @Nullable String goal;
    private @Nullable Instant occurredAt;
    private @Nullable String value;
    private @Nullable String currency;

    Builder() {}

    /** Required: the goal key of the referral's current step. */
    public Builder goal(String goal) {
      this.goal = goal;
      return this;
    }

    /** Required: when the step's goal happened (the API needs it). */
    public Builder occurredAt(Instant occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** The value in normal units, when the step has a minimum value. */
    public Builder value(@Nullable BigDecimal value) {
      this.value = value == null ? null : Money.formatValue(value);
      return this;
    }

    /** The value in normal units. */
    public Builder value(long value) {
      this.value = Money.formatValue(value);
      return this;
    }

    /** The value in normal units, as a decimal string like {@code "1500.50"}. */
    public Builder value(@Nullable String value) {
      this.value = value == null ? null : Money.formatValue(value);
      return this;
    }

    /** ISO 4217, with the value. */
    public Builder currency(@Nullable String currency) {
      this.currency = currency;
      return this;
    }

    public CompleteStepParams build() {
      return new CompleteStepParams(this);
    }
  }
}
