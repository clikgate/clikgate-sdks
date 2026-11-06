package com.clikgate;

import org.jspecify.annotations.Nullable;

/**
 * Options of the gateway helpers ({@link Payments#fromPaystack(Object, PaymentHelperOptions)} and the others).
 *
 * <pre>{@code
 * clikgate.payments().fromPaystack(verifyBody, PaymentHelperOptions.builder().goal("order_paid").build());
 * }</pre>
 */
public final class PaymentHelperOptions {
  /** No options. */
  public static final PaymentHelperOptions NONE = builder().build();

  final @Nullable String goal;
  final @Nullable String clickId;

  private PaymentHelperOptions(Builder b) {
    goal = b.goal;
    clickId = b.clickId;
  }

  public static Builder builder() {
    return new Builder();
  }

  /** Builder for {@link PaymentHelperOptions}. */
  public static final class Builder {
    private @Nullable String goal;
    private @Nullable String clickId;

    private Builder() {}

    /** A payment goal key. */
    public Builder goal(@Nullable String goal) {
      this.goal = goal;
      return this;
    }

    /** A click ID you kept; it wins over the {@code cg_click_id} in the gateway metadata. */
    public Builder clickId(@Nullable String clickId) {
      this.clickId = clickId;
      return this;
    }

    public PaymentHelperOptions build() {
      return new PaymentHelperOptions(this);
    }
  }
}
