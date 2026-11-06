package com.clikgate;

import com.clikgate.model.Provider;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * A payment your server has verified with the gateway, for {@link Payments#confirm(PaymentConfirmParams)}
 * ({@code POST /v1/payments/confirmations}). {@code provider}, {@code reference} and {@code status} are required.
 * Send either {@code amount} (normal units) or {@code amountMinor}, never both.
 *
 * <pre>{@code
 * PaymentConfirmParams p = PaymentConfirmParams.builder()
 *     .provider(Provider.PAYSTACK)
 *     .reference("T_ref_001")             // the gateway's reference
 *     .status("success")
 *     .amount(new BigDecimal("7500.00"))   // ₦7,500 in normal units
 *     .currency("NGN")
 *     .build();
 * }</pre>
 */
public final class PaymentConfirmParams {
  final @Nullable String provider;
  final @Nullable String reference;
  final @Nullable String status;
  final @Nullable Object amount;
  final @Nullable Object amountMinor;
  final @Nullable String currency;
  final @Nullable Object occurredAt;
  final @Nullable List<?> aliases;
  final @Nullable String clickId;
  final @Nullable String goal;
  final @Nullable Boolean test;
  final Map<String, @Nullable Object> extra;

  private PaymentConfirmParams(Builder b) {
    provider = b.provider;
    reference = b.reference;
    status = b.status;
    amount = b.amount;
    amountMinor = b.amountMinor;
    currency = b.currency;
    occurredAt = b.occurredAt;
    aliases = b.aliases == null ? null : Collections.unmodifiableList(new ArrayList<Object>(b.aliases));
    clickId = b.clickId;
    goal = b.goal;
    test = b.test;
    extra = Collections.unmodifiableMap(new LinkedHashMap<String, @Nullable Object>(b.extra));
  }

  public static Builder builder() {
    return new Builder();
  }

  /** Builder for {@link PaymentConfirmParams}. Every setter accepts null for "unset". */
  public static final class Builder {
    private @Nullable String provider;
    private @Nullable String reference;
    private @Nullable String status;
    private @Nullable Object amount;
    private @Nullable Object amountMinor;
    private @Nullable String currency;
    private @Nullable Object occurredAt;
    private @Nullable List<?> aliases;
    private @Nullable String clickId;
    private @Nullable String goal;
    private @Nullable Boolean test;
    private final Map<String, @Nullable Object> extra = new LinkedHashMap<>();

    private Builder() {}

    /** The provider, e.g. {@code Provider.PAYSTACK}. */
    public Builder provider(@Nullable Provider provider) {
      this.provider = provider == null ? null : provider.getValue();
      return this;
    }

    /**
     * The provider as its key ({@code paystack}, {@code flutterwave}, ...): also a gateway added after this SDK release
     * (the API validates it).
     */
    public Builder provider(@Nullable String provider) {
      this.provider = provider;
      return this;
    }

    /** The gateway's canonical reference, 1-128 characters. */
    public Builder reference(@Nullable String reference) {
      this.reference = reference;
      return this;
    }

    /** {@code success}, {@code partial}, {@code pending}, {@code failed}, {@code refunded} or {@code reversed}. */
    public Builder status(@Nullable String status) {
      this.status = status;
      return this;
    }

    /** The amount in normal units (for a refund: the amount refunded), sent as a decimal string with its scale. */
    public Builder amount(@Nullable BigDecimal amount) {
      this.amount = amount;
      return this;
    }

    /** An integer amount in normal units. */
    public Builder amount(long amount) {
      this.amount = amount;
      return this;
    }

    /** A decimal string in normal units, like {@code "7500.00"}. */
    public Builder amount(@Nullable String amount) {
      this.amount = amount;
      return this;
    }

    /** The amount in ISO 4217 minor units, instead of {@code amount}. */
    public Builder amountMinor(@Nullable Long amountMinor) {
      this.amountMinor = amountMinor;
      return this;
    }

    /** ISO 4217, upper or lower case. */
    public Builder currency(@Nullable String currency) {
      this.currency = currency;
      return this;
    }

    /** When the payment happened (defaults to now on the server). */
    public Builder occurredAt(@Nullable Instant occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** When the payment happened. */
    public Builder occurredAt(@Nullable OffsetDateTime occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** When the payment happened, as an RFC 3339 string (sent unchanged). */
    public Builder occurredAt(@Nullable String occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** Up to 5 other references of the same payment (a Stripe {@code cs_...} next to the {@code pi_...}). */
    public Builder aliases(@Nullable List<String> aliases) {
      this.aliases = aliases;
      return this;
    }

    /** The click ID you put in the gateway metadata ({@code cg_click_id}), used when no report comes. */
    public Builder clickId(@Nullable String clickId) {
      this.clickId = clickId;
      return this;
    }

    /** A payment goal key (default: the report's goal, else the default payment goal). */
    public Builder goal(@Nullable String goal) {
      this.goal = goal;
      return this;
    }

    /** {@code true} for a gateway test payment; it must match the key's mode. */
    public Builder test(@Nullable Boolean test) {
      this.test = test;
      return this;
    }

    /** An additional wire field, sent as is (forward compatibility). Checked by the private-mode guard. */
    public Builder extra(String field, @Nullable Object value) {
      this.extra.put(field, value);
      return this;
    }

    /** Advanced (adapters, tests): an amount of any supported type (BigDecimal, Long, Integer, BigInteger or a decimal String). */
    public Builder rawAmount(@Nullable Object amount) {
      this.amount = amount;
      return this;
    }

    /** Advanced (adapters, tests): an amountMinor of any type (checked locally: a non-negative integer). */
    public Builder rawAmountMinor(@Nullable Object amountMinor) {
      this.amountMinor = amountMinor;
      return this;
    }

    /** Advanced (adapters, tests): an occurredAt of any supported type (Instant, OffsetDateTime, ZonedDateTime, Date or String). */
    public Builder rawOccurredAt(@Nullable Object occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** Advanced (adapters, tests): aliases as any list (checked locally: strings only). */
    public Builder rawAliases(@Nullable List<?> aliases) {
      this.aliases = aliases;
      return this;
    }

    public PaymentConfirmParams build() {
      return new PaymentConfirmParams(this);
    }
  }
}
