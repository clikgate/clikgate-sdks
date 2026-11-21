<?php

declare(strict_types=1);

namespace App\Webhooks;

use App\Http;
use Clikgate\Enum\EventType;
use Clikgate\Exception\SignatureVerificationException;
use Clikgate\Model\WebhookEvent;
use Clikgate\Webhooks;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Slim\App;

/** Receives Clikgate webhooks. No sign-in here: the signature check is what protects the route. */
final class WebhookRoutes
{
    public function __construct(
        private readonly string $secret,
        private readonly ProcessedEvents $processedEvents,
        private readonly RewardStore $rewards,
    ) {}

    public function register(App $app): void
    {
        $app->post('/webhooks/clikgate', $this->receive(...));
    }

    // #region webhook
    private function receive(Request $request, Response $response): Response
    {
        $rawBody = (string) $request->getBody(); // the raw text: the signature covers exactly what Clikgate sent
        try {
            $event = Webhooks::verify($rawBody, $request->getHeaderLine('Clikgate-Signature') ?: null, $this->secret);
        } catch (SignatureVerificationException $e) {
            return Http::json($response, ['error' => $e->getErrorCode()], 400);
        }
        if (!$this->processedEvents->markNew($event->id)) {
            return $response; // a repeat delivery: answer 200 and do nothing
        }
        if (str_starts_with($event->type, 'referral.')) {
            $this->handleReferralEvent($event);
        }

        return $response; // 200; answer quickly, Clikgate waits up to 10 seconds
    }
    // #endregion

    // #region referral-event
    /**
     * Pays referral rewards. `$event->asReferral()` gives the referral: its `id`, and the `referrer` and `referee`
     * with `customerId` (your own user IDs; the referee's is null until the app identified them).
     */
    public function handleReferralEvent(WebhookEvent $event): void
    {
        $referral = $event->asReferral(); // null for an event that isn't referral.*
        $referrerUserId = $referral?->referrer->customerId;
        if (null === $referral || null === $referrerUserId) {
            return; // not a referral we can pay
        }
        $refereeUserId = $referral->referee->customerId;

        if (EventType::ReferralQualified === $event->type) {
            // Final: pay once. In production, queue a job here and answer the webhook straight away.
            $this->rewards->payOnce($referral->id, $referrerUserId, $refereeUserId);
        } elseif (EventType::ReferralDisqualified === $event->type) {
            $this->rewards->markDisqualified($referral->id, $referrerUserId, $refereeUserId); // pay nothing
        }
    }
    // #endregion
}
