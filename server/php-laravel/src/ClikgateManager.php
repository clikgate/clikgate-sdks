<?php

declare(strict_types=1);

namespace Clikgate\Laravel;

use Clikgate\ClickIds;
use Clikgate\Clicks;
use Clikgate\Clikgate as Client;
use Clikgate\Codes;
use Clikgate\Conversions;
use Clikgate\Exception\ConfigurationException;
use Clikgate\Generated\ApiClient;
use Clikgate\Goals;
use Clikgate\Installs;
use Clikgate\KnownCustomers;
use Clikgate\Laravel\Jobs\SendGoal;
use Clikgate\Links;
use Clikgate\Model\WebhookEvent;
use Clikgate\Payments;
use Clikgate\People;
use Clikgate\Privacy;
use Clikgate\Referrals;
use Clikgate\Webhooks;
use Illuminate\Contracts\Foundation\Application;

/**
 * What the `Clikgate` facade calls. `goal()` dispatches a queued job when `clikgate.queue` (`CLIKGATE_QUEUE`)
 * is set, and otherwise sends with the client's send mode. Everything else goes to the client.
 */
final class ClikgateManager
{
    public function __construct(private readonly Application $app) {}

    public function client(): Client
    {
        return $this->app->make(Client::class);
    }

    /**
     * Record a goal. Never throws. With `CLIKGATE_QUEUE` set, a {@see SendGoal} job sends it (retried by the queue;
     * the API ignores a second event with the same goal and reference, so a retry never double counts).
     *
     * ```php
     * Clikgate::goal('account_opened', ['clickId' => $application->click_id, 'reference' => $application->reference, 'value' => '2000000']);
     * ```
     *
     * @param array<string, mixed> $options
     */
    public function goal(string $key, array $options): void
    {
        $connection = $this->setting('clikgate.queue');
        if (\is_string($connection) && '' !== $connection) {
            try {
                $job = (new SendGoal($key, $options))->onConnection($connection);
                $queue = $this->setting('clikgate.queue_name');
                if (\is_string($queue) && '' !== $queue) {
                    $job->onQueue($queue);
                }
                dispatch($job);

                return;
            } catch (\Throwable $e) {
                report($e); // fall back to sending now: goal() never throws
            }
        }
        $this->client()->goal($key, $options);
    }

    private function setting(string $key): mixed
    {
        $repository = $this->app->make('config');

        return $repository instanceof \Illuminate\Contracts\Config\Repository ? $repository->get($key) : null;
    }

    public function goals(): Goals
    {
        return $this->client()->goals;
    }

    public function links(): Links
    {
        return $this->client()->links;
    }

    public function conversions(): Conversions
    {
        return $this->client()->conversions;
    }

    /**
     * Payments confirmed by your server, right after your own verification with the gateway.
     *
     * ```php
     * Clikgate::payments()->fromPaystack($verifyResponse, ['goal' => 'order_paid']);
     * ```
     */
    public function payments(): Payments
    {
        return $this->client()->payments;
    }

    public function clicks(): Clicks
    {
        return $this->client()->clicks;
    }

    /** Existing customers from before you added Clikgate: `import()` and `remove()`. */
    public function knownCustomers(): KnownCustomers
    {
        return $this->client()->knownCustomers;
    }

    /**
     * Referrals: referrers, referrals, overrides, steps and imports.
     *
     * ```php
     * $referrer = Clikgate::referrals()->getOrCreateReferrer('rpg_…', ['customerId' => (string) $user->id]);
     * // Your own exact code for a new referrer (409 code_taken when it is used in your organisation):
     * $referrer = Clikgate::referrals()->getOrCreateReferrer('rpg_…', ['customerId' => (string) $user->id, 'code' => 'ADA2026']);
     * ```
     */
    public function referrals(): Referrals
    {
        return $this->client()->referrals;
    }

    /** Privacy requests: `createRequest()`, `getRequest()`. */
    public function privacy(): Privacy
    {
        return $this->client()->privacy;
    }

    /** People: `get()`, `search()`, `setLabel()`. */
    public function people(): People
    {
        return $this->client()->people;
    }

    /** Installs: `getByCustomer()`, `getByInstallation()`. */
    public function installs(): Installs
    {
        return $this->client()->installs;
    }

    /** Offline and referral codes: `redeem()`. */
    public function codes(): Codes
    {
        return $this->client()->codes;
    }

    public function clickIds(): ClickIds
    {
        return $this->client()->clickIds;
    }

    public function api(): ApiClient
    {
        return $this->client()->api;
    }

    /**
     * @return array<string, mixed>|null
     */
    public function config(): ?array
    {
        return $this->client()->config();
    }

    public function flush(float $timeout = 10.0): bool
    {
        return $this->client()->flush($timeout);
    }

    /**
     * Create an identity token for the signed-in user (path A of
     * https://clikgate.com/docs/identify-users): return it in your sign-in and "current user" responses, and the app
     * passes it to the mobile SDK's `identifyUser()`. Uses `clikgate.identity_secret` (`CLIKGATE_IDENTITY_SECRET`), or
     * with `appId` that app's secret from `clikgate.identity_secrets` (`CLIKGATE_IDENTITY_SECRETS`). No network call.
     *
     * ```php
     * return response()->json(['user' => $user, 'clikgateIdentityToken' => Clikgate::createIdentityToken((string) $user->id)]);
     * // With the account date (version 2), so existing customers are never counted as referrals or new customers:
     * Clikgate::createIdentityToken((string) $user->id, ['customerSince' => $user->created_at]);
     * ```
     *
     * @param array{appId?: ?string, issuedAt?: ?int, customerSince?: \DateTimeInterface|int|null} $options
     */
    public function createIdentityToken(string $customerId, array $options = []): string
    {
        $raw = $this->setting('clikgate.identity_secrets');
        if (null !== $raw && '' !== $raw && null === ClikgateServiceProvider::identitySecrets($raw)) {
            // Never echo the value: it holds secrets.
            throw new ConfigurationException('clikgate.identity_secrets (CLIKGATE_IDENTITY_SECRETS) must be a JSON object of app IDs to identity secrets, e.g. {"app_…": "cgis_…"}.', 'invalid_identity_secrets', param: 'identity_secrets');
        }

        return $this->client()->createIdentityToken($customerId, $options);
    }

    /**
     * Tell Clikgate who a person is (see {@see Client::identifyUser()}). Path B of
     * https://clikgate.com/docs/identify-users needs no identity secret or token: the app sends the mobile SDK's
     * `Clikgate-Installation` header with its sign-in request and signed-in requests. After your own sign-in check
     * succeeds, and at every signed-in app open, pass `$request->clikgateInstallation()` (the parsed header, or
     * the raw header string) as `installation` with your signed-in user's ID (never a customer ID read from the
     * request). It is `null` when the header is missing or invalid (tracking is off): skip the call.
     *
     * ```php
     * if (null !== $installation = $request->clikgateInstallation()) {
     *     Clikgate::identifyUser(['installation' => $installation, 'customerId' => (string) $user->id]);
     * }
     * ```
     *
     * `customerSince` is when they became your customer; Clikgate keeps the earliest date unless
     * `customerSinceReplace` is true.
     *
     * @param array{clickId?: ?string, installation?: string|\Clikgate\Installation|null, appId?: ?string, installationId?: ?string, customerId?: ?string, label?: ?string, customerSince?: string|\DateTimeInterface|int|null, customerSinceReplace?: ?bool} $params
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed>
     */
    public function identifyUser(array $params, array $requestOptions = []): array
    {
        return $this->client()->identifyUser($params, $requestOptions);
    }

    /**
     * Verify a webhook (see {@see Webhooks::verify()}).
     *
     * ```php
     * $event = Clikgate::verifyWebhook($request->getContent(), $request->header('Clikgate-Signature'), config('services.clikgate.webhook_secret'));
     * $referral = $event->asReferral();   // null for other event types; $event['type'] keeps working
     * ```
     */
    public function verifyWebhook(string $rawBody, ?string $signatureHeader, string $secret, int $tolerance = 300): WebhookEvent
    {
        return Webhooks::verify($rawBody, $signatureHeader, $secret, $tolerance);
    }
}
