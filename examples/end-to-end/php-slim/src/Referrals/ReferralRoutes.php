<?php

declare(strict_types=1);

namespace App\Referrals;

use App\Config;
use App\Http;
use App\Users\UserStore;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

/**
 * The app calls `GET /me/referral` when the user opens "Invite friends". The user comes from your own session, so
 * nobody can ask for someone else's code.
 */
final class ReferralRoutes
{
    public function __construct(private readonly UserStore $users, private readonly Config $config) {}

    public function register(App $app): void
    {
        $app->get('/me/referral', $this->myReferral(...));
    }

    // #region referral-code
    /**
     * Gets or creates a user's referrer code in your referral program. The same user always gets the same code,
     * whether your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
     *
     * @return array{code: string, link: string}
     */
    public function getOrCreateReferralCode(string $userId): array
    {
        // Clikgate SDK 2.1.0: replace with $clikgate->referrals->getOrCreateReferrer($programId, ['customerId' => $userId]) (a Referrer: ->code, ->shortUrl)
        // Until then: the same API call the SDK will make (201 when created, 200 when it already existed).
        $url = $this->config->baseUrl . '/v1/referral-programs/' . rawurlencode($this->config->referralProgramId) . '/referrers';
        $context = stream_context_create(['http' => [
            'method' => 'POST',
            'header' => "Authorization: Bearer {$this->config->apiKey}\r\nContent-Type: application/json\r\n",
            'content' => json_encode(['customer_user_id' => $userId]), // your own user ID, as the app's identifyUser sends it
            'timeout' => 10,
        ]]);
        $body = file_get_contents($url, false, $context);
        if (false === $body) {
            throw new \RuntimeException('Clikgate referrers call failed');
        }
        $referrer = json_decode($body, true, flags: \JSON_THROW_ON_ERROR);

        return ['code' => (string) $referrer['code'], 'link' => (string) $referrer['short_url']];
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
