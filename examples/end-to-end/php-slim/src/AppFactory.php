<?php

declare(strict_types=1);

namespace App;

use App\Identity\AuthRoutes;
use App\Identity\ClikgateIdentity;
use App\Payments\PaymentRoutes;
use App\Referrals\ReferralRoutes;
use App\Users\UserStore;
use App\Webhooks\ProcessedEvents;
use App\Webhooks\RewardStore;
use App\Webhooks\WebhookRoutes;
use Clikgate\Clikgate;
use Clikgate\Psr15\ClikgateMiddleware;
use Psr\Http\Message\ServerRequestInterface as Request;
use Psr\Http\Server\RequestHandlerInterface as Handler;
use Slim\App;

/** Builds the Slim app and everything it uses, in one place. */
final class AppFactory
{
    /** @return array{app: App, clikgate: Clikgate, rewards: RewardStore} the client and rewards too, for the test */
    public static function create(Config $config, State $state): array
    {
        // One client per PHP process. after_response sends goals once the app has its answer (PHP-FPM).
        $clikgate = new Clikgate([
            'apiKey' => $config->apiKey,
            'baseUrl' => $config->baseUrl,
            'identitySecret' => $config->identitySecret,
            'sendMode' => 'after_response',
        ]);
        $users = new UserStore($state);
        $rewards = new RewardStore($state);
        $identity = new ClikgateIdentity($clikgate, null !== $config->identitySecret);

        $app = \Slim\Factory\AppFactory::create();
        (new AuthRoutes($users, $identity, $clikgate))->register($app);
        (new PaymentRoutes($users, $clikgate))->register($app);
        (new ReferralRoutes($users, $clikgate, $config->referralProgramId))->register($app);
        (new WebhookRoutes($config->webhookSecret, new ProcessedEvents($state), $rewards))->register($app);

        // Middleware runs last-added first: load the tables, then read the installation header, then parse JSON.
        $app->addBodyParsingMiddleware();
        $app->add(new ClikgateMiddleware($clikgate)); // sets the clikgate.installation request attribute
        $app->add(static function (Request $request, Handler $handler) use ($state) {
            $state->open();
            try {
                return $handler->handle($request);
            } finally {
                $state->close();
            }
        });
        $app->addErrorMiddleware(false, true, true);

        return ['app' => $app, 'clikgate' => $clikgate, 'rewards' => $rewards];
    }
}
