<?php

declare(strict_types=1);

namespace App\Identity;

use App\Users\AppUser;
use Clikgate\Clikgate;
use Clikgate\Exception\ClikgateException;
use Clikgate\Installation;

/**
 * Tells Clikgate which of your users is using the app. Two ways, and the sample shows both:
 * - Path A: an identity token in every response that says who is signed in. The app passes it to the mobile SDK.
 * - Path B: no secret. The app sends its `Clikgate-Installation` header, and the server calls identifyUser.
 * Your app needs only one of them.
 */
final class ClikgateIdentity
{
    public function __construct(private readonly Clikgate $clikgate, private readonly bool $tokensEnabled) {}

    // #region identity-token
    /**
     * Path A. Signed here with the identity secret, with no network call. Always pass the date the account was created
     * (never "now" at sign-in), so Clikgate can tell an existing customer from a new one. Make a new token for each
     * response, never store it, and never log it.
     */
    public function identityToken(AppUser $user): ?string
    {
        if (!$this->tokensEnabled) {
            return null; // no identity secret configured: the app uses Path B
        }

        return $this->clikgate->createIdentityToken($user->id, ['customerSince' => $user->createdAt]);
    }
    // #endregion

    // #region identify-installation
    /**
     * Path B. Call it only after your own sign-in check, with the user from your own session: the header names the app
     * installation, never the customer. The middleware gives null for a missing or invalid header (tracking is off on
     * that phone), and then there is nothing to do.
     */
    public function identifyInstallation(AppUser $user, ?Installation $installation): void
    {
        if (null === $installation) {
            return;
        }
        try {
            $this->clikgate->identifyUser($installation->toArray() + [
                'customerId' => $user->id,
                'customerSince' => $user->createdAt,
            ]);
        } catch (ClikgateException $e) {
            // Never block sign-in on this: the app calls /me at its next open, which tries again.
            error_log('Clikgate identifyUser failed: ' . $e->getErrorCode());
        }
    }
    // #endregion
}
