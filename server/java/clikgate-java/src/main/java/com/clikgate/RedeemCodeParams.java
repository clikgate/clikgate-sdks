package com.clikgate;

import com.clikgate.internal.Dates;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The parameters of {@link Codes#redeem(RedeemCodeParams)}: a code someone gave offline (USSD, SMS, an agent, a till).
 *
 * <pre>{@code
 * RedeemCodeParams.builder().externalId("ussd-session-881").code("ADA42").channel("ussd").build();
 * }</pre>
 */
public final class RedeemCodeParams {
  final @Nullable String externalId;
  final @Nullable String code;
  final @Nullable String channel;
  final @Nullable String appId;
  final @Nullable Instant occurredAt;
  final @Nullable Map<String, Object> metadata;
  final @Nullable Map<String, Object> subject;
  final @Nullable String agentId;
  final @Nullable Map<String, Object> location;

  private RedeemCodeParams(Builder b) {
    subject = b.subject;
    agentId = b.agentId;
    location = b.location;
    externalId = b.externalId;
    code = b.code;
    channel = b.channel;
    appId = b.appId;
    occurredAt = b.occurredAt;
    metadata = b.metadata;
  }

  public static Builder builder() {
    return new Builder();
  }

  Map<String, Object> wire() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("external_id", com.clikgate.internal.Requester.requireId(externalId, "external_id"));
    m.put("code", com.clikgate.internal.Requester.requireId(code, "code"));
    m.put("channel", com.clikgate.internal.Requester.requireId(channel, "channel"));
    if (subject != null) {
      m.put("subject", subject);
    }
    if (appId != null) {
      m.put("app_id", appId);
    }
    if (agentId != null) {
      m.put("agent_id", agentId);
    }
    if (location != null) {
      m.put("location", location);
    }
    if (occurredAt != null) {
      m.put("occurred_at", Dates.format(occurredAt));
    }
    if (metadata != null) {
      m.put("metadata", metadata);
    }
    return m;
  }

  /** Builder for {@link RedeemCodeParams}. */
  public static final class Builder {
    private @Nullable String externalId;
    private @Nullable String code;
    private @Nullable String channel;
    private @Nullable String appId;
    private @Nullable Instant occurredAt;
    private @Nullable Map<String, Object> metadata;
    private @Nullable Map<String, Object> subject;
    private @Nullable String agentId;
    private @Nullable Map<String, Object> location;

    Builder() {}

    /**
     * Who used the code: {@code type} is {@code installation_id}, {@code customer_user_id},
     * {@code external_customer_id}, {@code phone_hash} or {@code none}, and {@code id} its value (null for
     * {@code none}). A subject that maps to an install lets a referral code create a referral.
     */
    public Builder subject(String type, @Nullable String id) {
      Map<String, Object> m = new LinkedHashMap<>();
      m.put("type", type);
      if (id != null) {
        m.put("id", id);
      }
      this.subject = m;
      return this;
    }

    /** The agent who took the code (up to 100 characters). */
    public Builder agentId(@Nullable String agentId) {
      this.agentId = agentId;
      return this;
    }

    /** Where the code was used; each part may be null. */
    public Builder location(@Nullable String country, @Nullable String region, @Nullable String city, @Nullable String storeId) {
      Map<String, Object> m = new LinkedHashMap<>();
      String[][] parts = {{"country", country}, {"region", region}, {"city", city}, {"store_id", storeId}};
      for (String[] kv : parts) {
        if (kv[1] != null) {
          m.put(kv[0], kv[1]);
        }
      }
      this.location = m;
      return this;
    }

    /** Required: your ID for this redemption (the same ID is never counted twice). */
    public Builder externalId(String externalId) {
      this.externalId = externalId;
      return this;
    }

    /** Required: the code as typed. */
    public Builder code(String code) {
      this.code = code;
      return this;
    }

    /**
     * Required: {@code ussd}, {@code sms_keyword}, {@code agent}, {@code pos}, {@code in_store}, {@code call_center},
     * {@code event}, {@code print}, {@code radio} or {@code other}.
     */
    public Builder channel(String channel) {
      this.channel = channel;
      return this;
    }

    public Builder appId(@Nullable String appId) {
      this.appId = appId;
      return this;
    }

    /** When it happened (defaults to now on the server). */
    public Builder occurredAt(@Nullable Instant occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** Your own keys. */
    public Builder metadata(@Nullable Map<String, ?> metadata) {
      this.metadata = metadata == null ? null : new LinkedHashMap<String, Object>(metadata);
      return this;
    }

    public RedeemCodeParams build() {
      return new RedeemCodeParams(this);
    }
  }
}
