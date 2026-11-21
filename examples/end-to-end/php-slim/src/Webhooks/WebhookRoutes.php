<?php

declare(strict_types=1);

namespace App\Webhooks;

use App\Http;
use Clikgate\Exception\SignatureVerificationException;
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
        if (!$this->processedEvents->markNew((string) $event['id'])) {
            return $response; // a repeat delivery: answer 200 and do nothing
        }
        if (str_starts_with((string) $event['type'], 'referral.')) {
            $this->handleReferralEvent($event);
        }

        return $response; // 200; answer quickly, Clikgate waits up to 10 seconds
    }
    // #endregion

    // #region referral-event
    /**
     * Pays referral rewards. The event's `data.object` is the referral: its `id`, and the `referrer` and `referee`
     * with their `customer_user_id` (your own user IDs).
     *
     * @param array<string, mixed> $event
     */
    public function handleReferralEvent(array $event): void
    {
        // Clikgate SDK 2.1.0: replace with the typed referral event from the SDK instead of reading the array
        $referral = $event['data']['object'] ?? [];
        $referralId = self::text($referral, 'id');
        $referrerUserId = self::text($referral['referrer'] ?? null, 'customer_user_id');
        $refereeUserId = self::text($referral['referee'] ?? null, 'customer_user_id');
        if (null === $referralId || null === $referrerUserId) {
            return; // not a referral we can pay
        }
        if ('referral.qualified' === $event['type']) {
            // Final: pay once. In production, queue a job here and answer the webhook straight away.
            $this->rewards->payOnce($referralId, $referrerUserId, $refereeUserId);
        } elseif ('referral.disqualified' === $event['type']) {
            $this->rewards->markDisqualified($referralId, $referrerUserId, $refereeUserId); // pay nothing
        }
    }
    // #endregion

    private static function text(mixed $node, string $key): ?string
    {
        return \is_array($node) && \is_string($node[$key] ?? null) ? $node[$key] : null;
    }
}
