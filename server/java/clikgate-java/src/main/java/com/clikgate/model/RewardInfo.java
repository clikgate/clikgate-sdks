package com.clikgate.model;

import com.clikgate.internal.Currencies;
import java.math.BigDecimal;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * A referral program's reward, for your records only: Clikgate never pays rewards. Keys without a value are null.
 */
public final class RewardInfo extends WireObject {
  public RewardInfo(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** What the referrer gets, or null. */
  public @Nullable Side getReferrer() {
    return object("referrer", Side::new);
  }

  /** What the referee gets, or null. */
  public @Nullable Side getReferee() {
    return object("referee", Side::new);
  }

  /** A note shown with the reward, or null. */
  public @Nullable String getNote() {
    return string("note");
  }

  /** One side's reward. */
  public static final class Side extends WireObject {
    public Side(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    /** The amount in the currency's minor units (kobo, cents), or null. */
    public @Nullable Long getAmountMinor() {
      return longNumber("amount_minor");
    }

    /** {@link #getAmountMinor()} in normal units (exact, ISO 4217 decimals), or null. */
    public @Nullable BigDecimal getAmount() {
      return Currencies.toNormalUnits(getAmountMinor(), getCurrency());
    }

    /** ISO 4217, present with the amount. */
    public @Nullable String getCurrency() {
      return string("currency");
    }

    /** The reward in words, or null. */
    public @Nullable String getDescription() {
      return string("description");
    }
  }
}
