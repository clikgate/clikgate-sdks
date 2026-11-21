import type { Clikgate, Installation } from '@clikgate/node';
import type { AppUser } from './users.ts';

/**
 * Tells Clikgate which of your users is using the app. Two ways, and the sample shows both:
 * - Path A: an identity token in every response that says who is signed in. The app passes it to the mobile SDK.
 * - Path B: no secret. The app sends its `Clikgate-Installation` header, and the server calls `identifyUser`.
 * Your app needs only one of them.
 */
export class ClikgateIdentity {
  private readonly clikgate: Clikgate;
  private readonly tokensEnabled: boolean;

  constructor(clikgate: Clikgate, identitySecret: string | undefined) {
    this.clikgate = clikgate;
    this.tokensEnabled = Boolean(identitySecret);
  }

  // #region identity-token
  /**
   * Path A. Signed here with the identity secret, with no network call. Always pass the date the account was created
   * (never "now" at sign-in), so Clikgate can tell an existing customer from a new one. Make a new token for each
   * response, never store it, and never log it.
   */
  identityToken(user: AppUser): string | null {
    if (!this.tokensEnabled) return null; // no identity secret configured: the app uses Path B
    return this.clikgate.createIdentityToken(user.id, { customerSince: user.createdAt });
  }
  // #endregion

  // #region identify-installation
  /**
   * Path B. Call it only after your own sign-in check, with the user from your own session: the header names the app
   * installation, never the customer. The middleware gives null for a missing or invalid header (tracking is off on
   * that phone), and then there is nothing to do.
   */
  async identifyInstallation(user: AppUser, installation: Installation | null): Promise<void> {
    if (!installation) return;
    try {
      await this.clikgate.identifyUser({ installation, customerId: user.id, customerSince: user.createdAt });
    } catch (err) {
      // Never block sign-in on this: the app calls /me at its next open, which tries again.
      console.warn('Clikgate identifyUser failed:', err instanceof Error ? err.message : err);
    }
  }
  // #endregion
}
