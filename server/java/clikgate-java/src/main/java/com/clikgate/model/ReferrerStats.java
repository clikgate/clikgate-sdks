package com.clikgate.model;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A referrer's counters ({@code stats}), refreshed regularly (not live). Absent counters read as 0. */
public final class ReferrerStats extends WireObject {
  public ReferrerStats(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** Human clicks on the referrer's link. */
  public long getClicks() {
    return longOrZero("clicks");
  }

  /** Referrals of any status. */
  public long getInstalls() {
    return longOrZero("installs");
  }

  /** Referrals past their first qualification step (rejected ones excluded). */
  public long getSignups() {
    return longOrZero("signups");
  }

  /** Open referrals. */
  public long getInProgress() {
    return longOrZero("in_progress");
  }

  public long getQualified() {
    return longOrZero("qualified");
  }

  public long getDisqualified() {
    return longOrZero("disqualified");
  }

  public long getRejected() {
    return longOrZero("rejected");
  }

  /** Share of referees (0 to 1) who uninstalled within 7 days; null when none is old enough yet, or not computed yet. */
  public @Nullable Double getRefereeUninstallRate7d() {
    return doubleNumber("referee_uninstall_rate_7d");
  }
}
