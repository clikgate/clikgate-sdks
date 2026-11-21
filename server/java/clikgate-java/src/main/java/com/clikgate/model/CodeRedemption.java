package com.clikgate.model;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The answer of {@code codes().redeem(...)}: an offline touch, and the referral it created or found. */
public final class CodeRedemption extends WireObject {
  public CodeRedemption(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The offline touch recorded ({@code oft_...}). */
  public @Nullable String getOfflineTouchId() {
    return string("offline_touch_id");
  }

  /** The code that was redeemed. */
  public @Nullable RedeemedCode getCode() {
    return object("code", RedeemedCode::new);
  }

  /** The referral this redemption created or found (a referral code whose subject maps to an install), else null. */
  public @Nullable Referral getReferral() {
    return object("referral", Referral::new);
  }

  /** True once the touch is tied to an install (now, or later). */
  public boolean isLinked() {
    return Boolean.TRUE.equals(bool("linked"));
  }

  /** Why a referral code didn't create a referral (e.g. {@code already_referred}), else null. */
  public @Nullable ReferralError getReferralError() {
    return object("referral_error", ReferralError::new);
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** The code that was redeemed and what it belongs to. */
  public static final class RedeemedCode extends WireObject {
    public RedeemedCode(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getCode() {
      return string("code");
    }

    /** {@code link}, {@code campaign} or {@code referral}. */
    public @Nullable String getKind() {
      return string("kind");
    }

    public @Nullable String getLinkId() {
      return string("link_id");
    }

    public @Nullable String getCampaignId() {
      return string("campaign_id");
    }

    public @Nullable String getReferrerId() {
      return string("referrer_id");
    }

    public @Nullable String getProgramId() {
      return string("program_id");
    }
  }

  /** Why a referral code didn't create a referral. */
  public static final class ReferralError extends WireObject {
    public ReferralError(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getCode() {
      return string("code");
    }

    public @Nullable String getMessage() {
      return string("message");
    }
  }
}
