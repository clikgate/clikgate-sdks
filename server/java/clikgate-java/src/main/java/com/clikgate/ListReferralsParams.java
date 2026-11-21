package com.clikgate;

import com.clikgate.internal.Dates;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Filters for {@link Referrals#list(ListReferralsParams)} and {@link Referrals#listPage(ListReferralsParams)}.
 *
 * <pre>{@code
 * ListReferralsParams.builder().programId(programId).status("qualified").limit(100).build();
 * }</pre>
 */
public final class ListReferralsParams {
  /** No filters. */
  public static final ListReferralsParams NONE = builder().build();

  private final Map<String, Object> query;

  private ListReferralsParams(Map<String, Object> query) {
    this.query = query;
  }

  public static Builder builder() {
    return new Builder();
  }

  Map<String, Object> query() {
    return new LinkedHashMap<>(query);
  }

  /** Builder for {@link ListReferralsParams}. */
  public static final class Builder {
    private final Map<String, Object> q = new LinkedHashMap<>();

    Builder() {}

    private Builder put(String key, @Nullable Object value) {
      if (value == null) {
        q.remove(key);
      } else {
        q.put(key, value);
      }
      return this;
    }

    public Builder programId(@Nullable String programId) {
      return put("program_id", programId);
    }

    public Builder referrerId(@Nullable String referrerId) {
      return put("referrer_id", referrerId);
    }

    /** The referred customer's user ID (wire {@code referee_customer_user_id}). */
    public Builder refereeCustomerId(@Nullable String refereeCustomerId) {
      return put("referee_customer_user_id", refereeCustomerId);
    }

    /** {@code in_progress}, {@code holding}, {@code qualified}, {@code disqualified} or {@code rejected}. */
    public Builder status(@Nullable String status) {
      return put("status", status);
    }

    /** Why referrals were disqualified or rejected, e.g. {@code existing_user}. */
    public Builder reason(@Nullable String reason) {
      return put("reason", reason);
    }

    /** Created at or after. */
    public Builder from(@Nullable Instant from) {
      return put("from", from == null ? null : Dates.format(from));
    }

    /** Created before. */
    public Builder to(@Nullable Instant to) {
      return put("to", to == null ? null : Dates.format(to));
    }

    /** Page size, 1-100 (default 25). */
    public Builder limit(@Nullable Integer limit) {
      return put("limit", limit);
    }

    /** {@link Referrals#listPage} only: the cursor of the page to fetch (a page's {@code getNextCursor()}). */
    public Builder startingAfter(@Nullable String cursor) {
      return put("starting_after", cursor);
    }

    /** {@link Referrals#listPage} only: fetch the page before this cursor. */
    public Builder endingBefore(@Nullable String cursor) {
      return put("ending_before", cursor);
    }

    public ListReferralsParams build() {
      return new ListReferralsParams(new LinkedHashMap<>(q));
    }
  }
}
