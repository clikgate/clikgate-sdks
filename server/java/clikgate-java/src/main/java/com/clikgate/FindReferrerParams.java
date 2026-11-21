package com.clikgate;

import org.jspecify.annotations.Nullable;

/**
 * Who {@link Referrals#findReferrer(String, FindReferrerParams)} looks for: a customer ID or a referral code.
 *
 * <pre>{@code
 * clikgate.referrals().findReferrer(programId, FindReferrerParams.byCustomerId(user.getId()));
 * clikgate.referrals().findReferrer(programId, FindReferrerParams.byCode("ADA42"));
 * }</pre>
 */
public final class FindReferrerParams {
  final @Nullable String customerId;
  final @Nullable String code;

  private FindReferrerParams(@Nullable String customerId, @Nullable String code) {
    this.customerId = customerId;
    this.code = code;
  }

  /** The referrer of your user with this ID. */
  public static FindReferrerParams byCustomerId(String customerId) {
    return new FindReferrerParams(customerId, null);
  }

  /**
   * Exactly one of a customer ID and a code (the other null); {@code findReferrer} refuses both or neither with
   * {@code invalid_argument}.
   */
  public static FindReferrerParams of(@Nullable String customerId, @Nullable String code) {
    return new FindReferrerParams(customerId, code);
  }

  /** The referrer with this referral code. */
  public static FindReferrerParams byCode(String code) {
    return new FindReferrerParams(null, code);
  }
}
