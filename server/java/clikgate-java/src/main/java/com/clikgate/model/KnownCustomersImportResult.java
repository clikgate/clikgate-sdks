package com.clikgate.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/** The answer of {@code knownCustomers().importCustomers(...)}, summed over every batch. */
public final class KnownCustomersImportResult {
  private final long accepted;
  private final long refused;
  private final Map<String, Long> refusedByReason;

  public KnownCustomersImportResult(long accepted, long refused, Map<String, Long> refusedByReason) {
    this.accepted = accepted;
    this.refused = refused;
    this.refusedByReason = Collections.unmodifiableMap(new LinkedHashMap<>(refusedByReason));
  }

  /** Rows kept. */
  public long getAccepted() {
    return accepted;
  }

  /** Rows refused. */
  public long getRefused() {
    return refused;
  }

  /**
   * Refused rows by reason ({@code looks_like_email}, {@code looks_like_phone}, {@code looks_like_national_id},
   * {@code empty}, {@code too_long}, {@code bad_date}, {@code date_out_of_range}). Counts only: the API never returns
   * the refused IDs.
   */
  public Map<String, Long> getRefusedByReason() {
    return refusedByReason;
  }
}
