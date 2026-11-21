package com.example.clikgate.identity;

import com.clikgate.Clikgate;
import com.clikgate.IdentifyUserParams;
import com.clikgate.Installation;
import com.clikgate.exception.ClikgateException;
import com.example.clikgate.users.AppUser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Tells Clikgate which of your users is using the app. Two ways, and the sample shows both:
 *
 * <ul>
 *   <li>Path A: an identity token in every response that says who is signed in. The app passes it to the mobile SDK.
 *   <li>Path B: no secret. The app sends its {@code Clikgate-Installation} header, and the server calls identifyUser.
 * </ul>
 *
 * Your app needs only one of them.
 */
@Service
public class ClikgateIdentity {
  private static final Logger log = LoggerFactory.getLogger(ClikgateIdentity.class);

  private final Clikgate clikgate;
  private final boolean tokensEnabled;

  public ClikgateIdentity(Clikgate clikgate, @Value("${clikgate.identity-secret:}") String identitySecret) {
    this.clikgate = clikgate;
    this.tokensEnabled = !identitySecret.isBlank();
  }

  // #region identity-token
  /**
   * Path A. Signed here with the identity secret, with no network call. Always pass the date the account was created
   * (never "now" at sign-in), so Clikgate can tell an existing customer from a new one. Make a new token for each
   * response, never store it, and never log it.
   */
  public String identityToken(AppUser user) {
    if (!tokensEnabled) {
      return null; // no identity secret configured: the app uses Path B
    }
    return clikgate.createIdentityToken(user.id(), null, user.createdAt());
  }
  // #endregion

  // #region identify-installation
  /**
   * Path B. Call it only after your own sign-in check, with the user from your own session: the header names the app
   * installation, never the customer. The starter gives null for a missing or invalid header (tracking is off on that
   * phone), and then there is nothing to do.
   */
  public void identifyInstallation(AppUser user, Installation installation) {
    if (installation == null) {
      return;
    }
    try {
      clikgate.identifyUser(IdentifyUserParams.builder()
          .installation(installation)
          .customerId(user.id())
          .customerSince(user.createdAt())
          .build());
    } catch (ClikgateException e) {
      // Never block sign-in on this: the app calls /me at its next open, which tries again.
      log.warn("Clikgate identifyUser failed: {}", e.getCode());
    }
  }
  // #endregion
}
