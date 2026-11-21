package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.model.CodeRedemption;

/** Codes: redeem a link, campaign or referral code someone gave offline. */
public final class Codes {
  private final Core core;

  Codes(Core core) {
    this.core = core;
  }

  /**
   * Redeem a code given offline (USSD, SMS, an agent, a till). A referral code can create a referral.
   *
   * <pre>{@code
   * CodeRedemption r = clikgate.codes().redeem(RedeemCodeParams.builder().externalId("ussd-881").code("ADA42").channel("ussd").build());
   * }</pre>
   */
  public CodeRedemption redeem(RedeemCodeParams params) {
    return redeem(params, RequestOptions.NONE);
  }

  /** {@link #redeem(RedeemCodeParams)} with per-call options. */
  public CodeRedemption redeem(RedeemCodeParams params, RequestOptions options) {
    return new CodeRedemption(Links.asMap(core.requester.request(new ApiRequest("POST", "/v1/codes/redeem").body(params.wire()).options(options)).data));
  }
}
