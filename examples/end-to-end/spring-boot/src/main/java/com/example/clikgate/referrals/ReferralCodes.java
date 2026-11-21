package com.example.clikgate.referrals;

import com.clikgate.Clikgate;
import com.clikgate.model.Referrer;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Gets or creates a user's referrer code in your referral program. The same user always gets the same code, whether
 * your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
 */
@Component
public class ReferralCodes {
  /** What the app gets: the code and the referrer's short link to share. */
  public record ReferralCode(String code, String link) {}

  private final Clikgate clikgate;
  private final String programId;

  public ReferralCodes(Clikgate clikgate, @Value("${sample.referral-program-id}") String programId) {
    this.clikgate = clikgate;
    this.programId = programId; // one program ID in your configuration, never one per user
  }

  // #region referral-code
  public ReferralCode getOrCreateReferralCode(String userId) {
    // Your own user ID, exactly as the app's identifyUser sends it. referrer.isCreated() is true the first time.
    Referrer referrer = clikgate.referrals().getOrCreateReferrer(programId, userId);
    return new ReferralCode(referrer.getCode(), referrer.getShortUrl());
  }
  // #endregion
}
