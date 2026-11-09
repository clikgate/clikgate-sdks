<?php

declare(strict_types=1);

namespace Clikgate\Laravel;

use Clikgate\ClickIds;
use Clikgate\Clicks;
use Clikgate\Clikgate as Client;
use Clikgate\Conversions;
use Clikgate\Exception\ConfigurationException;
use Clikgate\Generated\ApiClient;
use Clikgate\Goals;
use Clikgate\Laravel\Jobs\SendGoal;
use Clikgate\Links;
use Clikgate\Payments;
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
     * ```
     *
     * @param array{appId?: ?string, issuedAt?: ?int} $options
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
     * https://clikgate.com/docs/identify-users needs no identity secret or token: the app sends its installation ID
     * (`getInstallationId()`) with the sign-in request, and you call this after sign-in and at every signed-in app
     * open. Skip it when the app sends no installation ID (tracking is off).
     *
     * ```php
     * if ($request->filled('installation_id')) {
     *     Clikgate::identifyUser(['appId' => 'app_…', 'installationId' => $request->string('installation_id')->toString(), 'customerId' => (string) $user->id]);
     * }
     * ```
     *
     * @param array{clickId?: ?string, appId?: ?string, installationId?: ?string, customerId?: ?string, label?: ?string} $params
     * @param array<string, mixed>                                                                                    $requestOptions
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
     * ```
     *
     * @return array<string, mixed>
     */
    public function verifyWebhook(string $rawBody, ?string $signatureHeader, string $secret, int $tolerance = 300): array
    {
        return Webhooks::verify($rawBody, $signatureHeader, $secret, $tolerance);
    }
}
