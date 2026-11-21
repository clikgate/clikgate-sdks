<?php

declare(strict_types=1);

namespace App\Identity;

use App\Http;
use App\Users\AppUser;
use App\Users\UserStore;
use Clikgate\Clikgate;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

/** Sign-up, sign-in and "current user": the three responses that tell the app who is signed in. */
final class AuthRoutes
{
    public function __construct(
        private readonly UserStore $users,
        private readonly ClikgateIdentity $identity,
        private readonly Clikgate $clikgate,
    ) {}

    public function register(App $app): void
    {
        $app->post('/auth/sign-up', $this->signUp(...));
        $app->post('/auth/sign-in', $this->signIn(...));
        $app->get('/me', $this->me(...));
    }

    private function signUp(Request $request, Response $response): Response
    {
        $user = $this->users->create(Http::field($request, 'email'), Http::field($request, 'password'));
        if (null === $user) {
            return Http::json($response, ['error' => 'email_taken'], 409);
        }
        $this->identity->identifyInstallation($user, Http::installation($request));
        // #region server-goal
        // A goal only your server knows about. goal() never throws, and the reference (your own ID for the event)
        // makes a resend count once. With sendMode after_response it is sent after the app has its answer.
        $this->clikgate->goal('account_opened', ['reference' => $user->id]);
        // #endregion

        return Http::json($response, $this->session($user), 201);
    }

    private function signIn(Request $request, Response $response): Response
    {
        $user = $this->users->signIn(Http::field($request, 'email'), Http::field($request, 'password'));
        if (null === $user) {
            return Http::json($response, ['error' => 'invalid_credentials'], 401);
        }
        $this->identity->identifyInstallation($user, Http::installation($request)); // only after your own check

        return Http::json($response, $this->session($user));
    }

    /** The app calls this at every open, so it gets a fresh token and Path B runs again within Clikgate's 7 days. */
    private function me(Request $request, Response $response): Response
    {
        $user = Http::signedInUser($request, $this->users);
        if (null === $user) {
            return Http::json($response, ['error' => 'not_signed_in'], 401);
        }
        $this->identity->identifyInstallation($user, Http::installation($request));

        return Http::json($response, ['user' => $user, 'clikgateIdentityToken' => $this->identity->identityToken($user)]);
    }

    /** @return array<string, mixed> Every response that says who is signed in carries the token (null without a secret). */
    private function session(AppUser $user): array
    {
        return [
            'user' => $user,
            'accessToken' => $this->users->startSession($user),
            'clikgateIdentityToken' => $this->identity->identityToken($user),
        ];
    }
}
