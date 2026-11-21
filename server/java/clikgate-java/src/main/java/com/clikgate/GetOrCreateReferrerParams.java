package com.clikgate;

import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The parameters of {@link Referrals#getOrCreateReferrer(String, GetOrCreateReferrerParams)}.
 *
 * <pre>{@code
 * GetOrCreateReferrerParams.builder().customerId(user.getId()).displayName("Ada").build();
 * }</pre>
 */
public final class GetOrCreateReferrerParams {
  final @Nullable String customerId;
  final @Nullable String displayName;
  final @Nullable String externalCode;

  private GetOrCreateReferrerParams(Builder b) {
    customerId = b.customerId;
    displayName = b.displayName;
    externalCode = b.externalCode;
  }

  /** Only the customer ID. */
  public static GetOrCreateReferrerParams of(String customerId) {
    return builder().customerId(customerId).build();
  }

  public static Builder builder() {
    return new Builder();
  }

  Map<String, Object> wire() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("customer_user_id", com.clikgate.internal.Requester.requireId(customerId, "customer_id"));
    if (displayName != null) {
      m.put("display_name", displayName);
    }
    if (externalCode != null) {
      m.put("external_code", externalCode);
    }
    return m;
  }

  /** Builder for {@link GetOrCreateReferrerParams}. */
  public static final class Builder {
    private @Nullable String customerId;
    private @Nullable String displayName;
    private @Nullable String externalCode;

    Builder() {}

    /** Required: your signed-in user's ID (never a value read from the request). */
    public Builder customerId(String customerId) {
      this.customerId = customerId;
      return this;
    }

    /** The name shown to the people they refer. */
    public Builder displayName(@Nullable String displayName) {
      this.displayName = displayName;
      return this;
    }

    /** Your own code for this referrer. */
    public Builder externalCode(@Nullable String externalCode) {
      this.externalCode = externalCode;
      return this;
    }

    public GetOrCreateReferrerParams build() {
      return new GetOrCreateReferrerParams(this);
    }
  }
}
