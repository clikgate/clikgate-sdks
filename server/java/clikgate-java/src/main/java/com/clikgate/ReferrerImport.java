package com.clikgate;

import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * One row of {@link Referrals#importReferrers(String, java.util.List)}.
 *
 * <pre>{@code
 * ReferrerImport.of("user_42").displayName("Ada").externalCode("ADA42");
 * }</pre>
 */
public final class ReferrerImport {
  private final String customerId;
  private final @Nullable String externalCode;
  private final @Nullable String displayName;

  private ReferrerImport(String customerId, @Nullable String externalCode, @Nullable String displayName) {
    this.customerId = customerId;
    this.externalCode = externalCode;
    this.displayName = displayName;
  }

  /** A row for your user with this ID. */
  public static ReferrerImport of(String customerId) {
    return new ReferrerImport(customerId, null, null);
  }

  /** A copy with your own code for this referrer. */
  public ReferrerImport externalCode(@Nullable String externalCode) {
    return new ReferrerImport(customerId, externalCode, displayName);
  }

  /** A copy with the name shown to the people they refer. */
  public ReferrerImport displayName(@Nullable String displayName) {
    return new ReferrerImport(customerId, externalCode, displayName);
  }

  public String getCustomerId() {
    return customerId;
  }

  public @Nullable String getExternalCode() {
    return externalCode;
  }

  public @Nullable String getDisplayName() {
    return displayName;
  }

  Map<String, Object> wire() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("customer_user_id", com.clikgate.internal.Requester.requireId(customerId, "customer_id"));
    if (externalCode != null) {
      m.put("external_code", externalCode);
    }
    if (displayName != null) {
      m.put("display_name", displayName);
    }
    return m;
  }
}
