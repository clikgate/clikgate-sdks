<?php

declare(strict_types=1);

namespace App\Referrals;

use App\Http;
use App\Users\UserStore;
use Clikgate\Clikgate;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

/**
 * The app calls `GET /me/referral` when the user opens "Invite friends". The user comes from your own session, so
 * nobody can ask for someone else's code.
 */
final class ReferralRoutes
{
    public function __construct(
        private readonly UserStore $users,
        private readonly Clikgate $clikgate,
        private readonly string $referralProgramId, // one program ID in your configuration, never one per user
    ) {}

    public function register(App $app): void
    {
        $app->get('/me/referral', $this->myReferral(...));
    }

    // #region referral-code
    /**
     * Gets or creates a user's referrer code in your referral program. The same user always gets the same code,
     * whether your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
     *
     * @return array{code: string, link: ?string}
     */
    public function getOrCreateReferralCode(string $userId): array
    {
        // Your own user ID, exactly as the app's identifyUser sends it. $referrer->created is true the first time.
        $referrer = $this->clikgate->referrals->getOrCreateReferrer($this->referralProgramId, ['customerId' => $userId]);

        return ['code' => $referrer->code, 'link' => $referrer->shortUrl];
    }
    // #endregion

    private function myReferral(Request $request, Response $response): Response
    {
        $user = Http::signedInUser($request, $this->users);
        if (null === $user) {
            return Http::json($response, ['error' => 'not_signed_in'], 401);
        }

        return Http::json($response, $this->getOrCreateReferralCode($user->id)); // {"code": "...", "link": "https://..."}
    }
}
