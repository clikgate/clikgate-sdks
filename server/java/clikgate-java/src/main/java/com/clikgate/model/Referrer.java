package com.clikgate.model;

import java.time.Instant;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * A referrer: a customer with a referral code and link in a program ({@code /v1/referrers}, {@code referrer.*}
 * webhooks). Every field is in {@link #toMap()}.
 */
public final class Referrer extends WireObject {
  private final boolean created;

  public Referrer(@Nullable Map<String, ?> fields) {
    this(fields, false);
  }

  public Referrer(@Nullable Map<String, ?> fields, boolean created) {
    super(fields);
    this.created = created;
  }

  /**
   * True when {@code referrals().getOrCreateReferrer(...)} created this referrer (the API answered {@code 201});
   * false when it already existed, and for every other call.
   */
  public boolean isCreated() {
    return created;
  }

  /** The referrer ID ({@code rfr_...}). */
  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getProgramId() {
    return string("program_id");
  }

  /** Your user ID for this customer (wire {@code customer_user_id}). */
  public @Nullable String getCustomerId() {
    return string("customer_user_id");
  }

  public @Nullable String getDisplayName() {
    return string("display_name");
  }

  /** The referral code people type or share. */
  public @Nullable String getCode() {
    return string("code");
  }

  /** Your own code for this referrer, else null. */
  public @Nullable String getExternalCode() {
    return string("external_code");
  }

  /** The referrer's link, else null. */
  public @Nullable String getLinkId() {
    return string("link_id");
  }

  /** The URL to share: the code URL, else the short link. */
  public @Nullable String getUrl() {
    return string("url");
  }

  public @Nullable String getShortUrl() {
    return string("short_url");
  }

  /** {@code active} or {@code blocked}. */
  public @Nullable String getStatus() {
    return string("status");
  }

  public @Nullable String getBlockedReason() {
    return string("blocked_reason");
  }

  public @Nullable Instant getBlockedAt() {
    return instant("blocked_at");
  }

  /** The referrer's counters, refreshed regularly (not live). */
  public ReferrerStats getStats() {
    ReferrerStats s = object("stats", ReferrerStats::new);
    return s == null ? new ReferrerStats(null) : s;
  }

  /** Your own keys on this referrer; empty when it has none. */
  public Map<String, @Nullable Object> getAttributes() {
    return mapOrEmpty("attributes");
  }

  /** True when this referrer is hidden from leaderboards. */
  public boolean isLeaderboardOptOut() {
    return Boolean.TRUE.equals(bool("leaderboard_opt_out"));
  }

  public @Nullable Instant getLastActivityAt() {
    return instant("last_activity_at");
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getUpdatedAt() {
    return instant("updated_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }
}
