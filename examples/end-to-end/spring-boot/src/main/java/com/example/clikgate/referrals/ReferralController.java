package com.example.clikgate.referrals;

import com.example.clikgate.auth.SignedInUser;
import com.example.clikgate.users.AppUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * The app calls this when the user opens "Invite friends". The user comes from your own session, so nobody can ask
 * for someone else's code.
 */
@RestController
public class ReferralController {
  private final SignedInUser signedInUser;
  private final ReferralCodes referralCodes;

  public ReferralController(SignedInUser signedInUser, ReferralCodes referralCodes) {
    this.signedInUser = signedInUser;
    this.referralCodes = referralCodes;
  }

  @GetMapping("/me/referral")
  ReferralCodes.ReferralCode myReferral(@RequestHeader(name = "Authorization", required = false) String authorization) {
    AppUser user = signedInUser.require(authorization);
    return referralCodes.getOrCreateReferralCode(user.id()); // answers {"code": "...", "link": "https://..."}
  }
}
