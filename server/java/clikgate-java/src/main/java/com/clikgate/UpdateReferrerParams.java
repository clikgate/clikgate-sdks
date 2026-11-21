package com.clikgate;

import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The changes of {@link Referrals#updateReferrer(String, UpdateReferrerParams)}. Only the fields you set are sent.
 *
 * <pre>{@code
 * UpdateReferrerParams.builder().displayName("Ada L.").attributes(Collections.singletonMap("tier", "gold")).build();
 * }</pre>
 */
public final class UpdateReferrerParams {
  private final Map<String, @Nullable Object> body;

  private UpdateReferrerParams(Map<String, @Nullable Object> body) {
    this.body = body;
  }

  public static Builder builder() {
    return new Builder();
  }

  Map<String, @Nullable Object> wire() {
    return new LinkedHashMap<>(body);
  }

  /** Builder for {@link UpdateReferrerParams}. */
  public static final class Builder {
    private final Map<String, @Nullable Object> body = new LinkedHashMap<>();

    Builder() {}

    /** The name shown to the people they refer; null clears it. */
    public Builder displayName(@Nullable String displayName) {
      body.put("display_name", displayName);
      return this;
    }

    /** Your own code for this referrer; null clears it. */
    public Builder externalCode(@Nullable String externalCode) {
      body.put("external_code", externalCode);
      return this;
    }

    /** True hides the referrer from leaderboards. */
    public Builder leaderboardOptOut(boolean leaderboardOptOut) {
      body.put("leaderboard_opt_out", leaderboardOptOut);
      return this;
    }

    /** Your own keys on this referrer (replaces them); null clears them. */
    public Builder attributes(@Nullable Map<String, ?> attributes) {
      body.put("attributes", attributes == null ? null : new LinkedHashMap<String, Object>(attributes));
      return this;
    }

    public UpdateReferrerParams build() {
      return new UpdateReferrerParams(new LinkedHashMap<>(body));
    }
  }
}
