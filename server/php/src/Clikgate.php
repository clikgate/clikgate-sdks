<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\ConfigurationException;
use Clikgate\Exception\ErrorMapper;
use Clikgate\Generated\ApiClient;
use Clikgate\Http\ApiRequest;
use Clikgate\Http\Clock;
use Clikgate\Http\CurlTransport;
use Clikgate\Http\Psr18Transport;
use Clikgate\Http\Requester;
use Clikgate\Http\SystemClock;
use Clikgate\Http\Transport;
use Http\Discovery\Psr17FactoryDiscovery;
use Http\Discovery\Psr18ClientDiscovery;
use Psr\Http\Client\ClientInterface;
use Psr\Log\LoggerInterface;

/**
 * The Clikgate client. Create one per process and reuse it.
 *
 * ```php
 * $clikgate = new \Clikgate\Clikgate();      // reads CLIKGATE_API_KEY
 * $clikgate->goal('account_opened', ['clickId' => $clickId, 'reference' => 'APP-55231', 'value' => '2000000']);
 * ```
 *
 * Options (all optional):
 * - `apiKey`: `cg_live_…` or `cg_test_…` (default: env `CLIKGATE_API_KEY`). The mode comes from the prefix.
 * - `baseUrl`: default env `CLIKGATE_BASE_URL`, else `https://api.clikgate.com`.
 * - `timeout`: per-attempt timeout in seconds (default 3).
 * - `maxRetries`: retries for network errors, timeouts and HTTP 429, 500, 502, 503 and 504 (default 3, at most 10).
 * - `sendMode`: `sync` (default: `goal()` sends at once and blocks), `after_response` (sent after
 *   `fastcgi_finish_request()`, else at shutdown) or `background` (queued; sent per `batchSize`, on `flush()` and at shutdown).
 * - `privateMode`: `'auto'` (default), `true` or `false`.
 * - `clickIdParam`: the click-ID query parameter (default: from config, else `cgid`).
 * - `logger`: a PSR-3 logger (default: `error_log()` for warnings and errors). Warnings carry `['clikgate_code' => …]`.
 * - `onError`: `function (ClikgateException $e, ErrorContext $context): void` for failures that can't throw.
 * - `httpClient`: a PSR-18 client (configure its timeout and proxy yourself). Default: ext-curl, else discovery.
 * - `proxy`: an `http(s)://user:pass@host:port` proxy, or `false` to ignore `https_proxy`/`HTTPS_PROXY`.
 * - `batchSize` (100), `flushInterval` (accepted for parity; PHP has no timers), `maxQueueSize` (10 000),
 *   `shutdownHooks` (true: flush queued events with `register_shutdown_function`).
 * - Advanced (tests): `clock` (a {@see Clock}) and `random` (a callable returning a float in [0, 1)).
 */
final class Clikgate
{
    private const OPTIONS = ['apiKey', 'baseUrl', 'timeout', 'maxRetries', 'sendMode', 'privateMode', 'clickIdParam', 'logger', 'onError', 'httpClient', 'proxy', 'batchSize', 'flushInterval', 'maxQueueSize', 'shutdownHooks', 'identitySecret', 'identitySecrets', 'clock', 'random'];

    /** `live` or `test`, from the API key prefix. */
    public readonly string $mode;
    private readonly ?string $identitySecret;
    /** @var array<string, string>|null */
    private readonly ?array $identitySecrets;
    /** Goal events. */
    public readonly Goals $goals;
    /** Conversions (older API). */
    public readonly Conversions $conversions;
    /** Payments confirmed by your server after your own verification: `confirm()`, `fromPaystack()`, ... */
    public readonly Payments $payments;
    /** Links. */
    public readonly Links $links;
    /** Clicks. */
    public readonly Clicks $clicks;
    /** Click-ID helpers using this client's `clickIdParam` (or the organisation's, from config). */
    public readonly ClickIds $clickIds;
    /** Every API-key operation, generated from openapi.json ("advanced"). */
    public readonly ApiClient $api;

    private readonly Core $core;
    private readonly GoalQueue $queue;
    private readonly string $sendMode;
    private bool $closed = false;
    private bool $shutdownRegistered = false;
    private readonly bool $shutdownHooks;

    /**
     * @param array<string, mixed> $options
     *
     * @throws ConfigurationException
     */
    public function __construct(array $options = [])
    {
        foreach (array_keys($options) as $k) {
            if (!\in_array($k, self::OPTIONS, true)) {
                throw self::invalid((string) $k, \sprintf('Unknown option "%s". See https://clikgate.com/docs/sdks/php#options.', $k));
            }
        }
        $apiKey = $options['apiKey'] ?? (getenv('CLIKGATE_API_KEY') ?: null);
        if (!\is_string($apiKey) || '' === $apiKey) {
            throw new ConfigurationException("No API key: pass ['apiKey' => …] or set CLIKGATE_API_KEY (cg_live_… or cg_test_…).", 'missing_api_key', param: 'apiKey');
        }
        if (1 !== preg_match('/^cg_(live|test)_[A-Za-z0-9_]+$/D', $apiKey, $m)) {
            throw new ConfigurationException(\sprintf('The API key is %s. Server SDKs need a cg_live_… or cg_test_… API key from Developers → API keys.', self::keyType($apiKey)), 'invalid_api_key', param: 'apiKey');
        }
        $this->mode = $m[1];
        $baseUrl = $options['baseUrl'] ?? (getenv('CLIKGATE_BASE_URL') ?: 'https://api.clikgate.com');
        if (!\is_string($baseUrl)) {
            throw self::invalid('baseUrl', 'baseUrl must be a string.');
        }
        $baseUrl = rtrim($baseUrl, '/');
        $parts = parse_url($baseUrl);
        $scheme = \is_array($parts) ? ($parts['scheme'] ?? '') : '';
        $host = \is_array($parts) ? ($parts['host'] ?? '') : '';
        if ('' === $host || !('https' === $scheme || ('http' === $scheme && \in_array($host, ['localhost', '127.0.0.1', '[::1]'], true)))) {
            throw self::invalid('baseUrl', 'baseUrl must use https:// (http:// only for localhost).');
        }
        $timeout = self::number($options, 'timeout', 3.0, 0.001, 600.0, false);
        $maxRetries = (int) self::number($options, 'maxRetries', 3, 0, 10, true);
        $batchSize = (int) self::number($options, 'batchSize', 100, 1, 500, true);
        self::number($options, 'flushInterval', 1.0, 0.001, 3600.0, false);
        $maxQueueSize = (int) self::number($options, 'maxQueueSize', 10_000, 1, 1_000_000, true);
        $sendMode = $options['sendMode'] ?? 'sync';
        if (!\in_array($sendMode, ['sync', 'background', 'after_response'], true)) {
            throw self::invalid('sendMode', "sendMode must be 'sync', 'after_response' or 'background'.");
        }
        $privateMode = $options['privateMode'] ?? 'auto';
        if ('auto' !== $privateMode && !\is_bool($privateMode)) {
            throw self::invalid('privateMode', "privateMode must be 'auto', true or false.");
        }
        $clickIdParam = $options['clickIdParam'] ?? null;
        if (null !== $clickIdParam && (!\is_string($clickIdParam) || 1 !== preg_match('/^[A-Za-z0-9_]{1,32}$/D', $clickIdParam))) {
            throw self::invalid('clickIdParam', 'clickIdParam must be 1-32 letters, digits or underscores.');
        }
        $logger = $options['logger'] ?? new ErrorLogLogger();
        if (!$logger instanceof LoggerInterface) {
            throw self::invalid('logger', 'logger must be a PSR-3 LoggerInterface.');
        }
        $onError = $options['onError'] ?? null;
        if (null !== $onError && !\is_callable($onError)) {
            throw self::invalid('onError', 'onError must be callable.');
        }
        $clock = $options['clock'] ?? new SystemClock();
        if (!$clock instanceof Clock) {
            throw self::invalid('clock', 'clock must implement Clikgate\Http\Clock.');
        }
        $random = $options['random'] ?? static fn(): float => mt_rand() / (mt_getrandmax() + 1);
        if (!\is_callable($random)) {
            throw self::invalid('random', 'random must be callable.');
        }
        $proxy = $options['proxy'] ?? null;
        if (null !== $proxy && false !== $proxy && (!\is_string($proxy) || !\in_array(parse_url($proxy, \PHP_URL_SCHEME), ['http', 'https'], true))) {
            throw self::invalid('proxy', 'proxy must be an http:// or https:// URL, or false.');
        }
        $transport = self::transport($options['httpClient'] ?? null, $proxy);

        $requester = new Requester($apiKey, $baseUrl, $timeout, $maxRetries, UserAgent::build(), $transport, $clock, $random);
        $this->core = new Core($requester, $logger, $privateMode, $timeout, $onError);
        $this->sendMode = $sendMode;
        $this->queue = new GoalQueue($this->core, $batchSize, $maxQueueSize);
        $this->shutdownHooks = (bool) ($options['shutdownHooks'] ?? true);
        $this->goals = new Goals($this->core);
        $this->conversions = new Conversions($this->core);
        $this->payments = new Payments($this->core);
        $this->links = new Links($this->core);
        $this->clicks = new Clicks($this->core);
        $core = $this->core;
        $this->clickIds = new ClickIds(static function () use ($clickIdParam, $core): string {
            $fromConfig = $core->peekConfig()['click_id_param'] ?? null;

            return $clickIdParam ?? (\is_string($fromConfig) ? $fromConfig : 'cgid');
        });
        $this->api = new ApiClient($requester);
        $identitySecret = $options['identitySecret'] ?? null;
        if (null !== $identitySecret && (!\is_string($identitySecret) || '' === $identitySecret)) {
            throw self::invalid('identitySecret', 'identitySecret must be a non-empty string.');
        }
        $rawSecrets = $options['identitySecrets'] ?? null;
        $identitySecrets = null;
        if (null !== $rawSecrets) {
            if (!\is_array($rawSecrets)) {
                throw self::invalid('identitySecrets', 'identitySecrets must be an array of app IDs to identity secrets.');
            }
            $identitySecrets = [];
            foreach ($rawSecrets as $k => $v) {
                if (!\is_string($k) || !\is_string($v) || '' === $v) {
                    throw self::invalid('identitySecrets', 'identitySecrets must be an array of app IDs to identity secrets.');
                }
                $identitySecrets[$k] = $v;
            }
        }
        $this->identitySecret = $identitySecret;
        $this->identitySecrets = $identitySecrets;
    }

    /**
     * Record a goal. **Never throws**: failures go to `logger` and `onError`.
     *
     * In `sync` mode (the default) it sends one request and waits; `after_response` sends after the response
     * has gone to the visitor; `background` batches. See {@see Goals} for the options.
     *
     * ```php
     * $clikgate->goal('account_opened', ['clickId' => $application->click_id, 'reference' => 'APP-55231', 'value' => '2000000', 'currency' => 'NGN']);
     * ```
     *
     * @param array<string, mixed> $options
     */
    public function goal(string $key, array $options): void
    {
        $shown = fn(): array => ['goal' => $key, 'reference' => $this->core->shownReference($options['reference'] ?? null)];
        try {
            if ($this->closed) {
                $this->core->report(ErrorMapper::local('client_closed', 'This Clikgate client is closed.'), new ErrorContext('goal', [$shown()], true));

                return;
            }
            $wire = Goals::wire($key, $options);
            if ('sync' === $this->sendMode) {
                Goals::checkBeforeSend($this->core, $this->core->guardState(), $wire);
                $this->goals->sendWire($wire);

                return;
            }
            $this->registerShutdown();
            $this->queue->enqueue($wire, 'background' === $this->sendMode);
        } catch (\Throwable $e) {
            try {
                $this->core->report(ErrorMapper::wrap($e), new ErrorContext('goal', [$shown()], true));
            } catch (\Throwable) {
            }
        }
    }

    /**
     * Create an identity token for the signed-in user (path A of https://clikgate.com/docs/identify-users).
     * Return it in your sign-in and "current user" responses; the app passes it to the mobile SDK's `identifyUser()`.
     * Uses the `identitySecret` / `identitySecrets` options, else `CLIKGATE_IDENTITY_SECRET` / `CLIKGATE_IDENTITY_SECRETS`.
     * No network call. See {@see IdentityToken::create()}.
     *
     * ```php
     * return ['user' => $user, 'clikgateIdentityToken' => $clikgate->createIdentityToken((string) $user->id)];
     * $clikgate->createIdentityToken((string) $user->id, ['appId' => 'app_…']);   // several apps
     * ```
     *
     * @param array{appId?: ?string, issuedAt?: ?int} $options
     */
    public function createIdentityToken(string $customerId, array $options = []): string
    {
        return IdentityToken::createWith($customerId, ['appId' => $options['appId'] ?? null, 'issuedAt' => $options['issuedAt'] ?? null], $this->identitySecret, $this->identitySecrets);
    }

    /**
     * Tell Clikgate who a person is (`POST /v1/people/identify`): a click (`clickId`), an app installation (`appId` +
     * `installationId`) or your `customerId`, at least one. With a click or installation, `customerId` links it to
     * that customer. `label` is what your team sees instead of the click ID (1-80 characters, `''` clears it; Growth
     * and up). Always verified (your server), so it also satisfies a referral program's `require_identity_token`.
     * In private mode `customerId` is refused locally and `label` needs "Allow labels in private mode".
     *
     * Path B of https://clikgate.com/docs/identify-users (no identity secret or token): the app reads
     * `getInstallationId()` and sends it in its sign-in request; your server calls this with `appId`,
     * `installationId`, `customerId` and optionally `label`, after sign-in and at every signed-in app open. When the
     * app sends no installation ID (tracking is off), skip the call. Clikgate accepts installations active in the
     * last 7 days.
     *
     * ```php
     * $clikgate->identifyUser(['clickId' => $order->clickId, 'customerId' => 'user_42', 'label' => 'Ada (VIP)']);
     * if ($installationId !== null) {
     *     $clikgate->identifyUser(['appId' => 'app_…', 'installationId' => $installationId, 'customerId' => (string) $user->id]);
     * }
     * ```
     *
     * @param array{clickId?: ?string, appId?: ?string, installationId?: ?string, customerId?: ?string, label?: ?string} $params
     * @param array<string, mixed> $requestOptions
     *
     * @return array<string, mixed> `{object: "person_identified", person_id, label_ignored}`
     */
    public function identifyUser(array $params, array $requestOptions = []): array
    {
        $appId = $params['appId'] ?? null;
        $installationId = $params['installationId'] ?? null;
        if ((null === $appId) !== (null === $installationId)) {
            throw ErrorMapper::local('invalid_request', 'Send appId and installationId together.', null === $appId ? 'app_id' : 'installation_id');
        }
        if (null === ($params['clickId'] ?? null) && null === $installationId && null === ($params['customerId'] ?? null)) {
            throw ErrorMapper::local('invalid_request', 'Send clickId, appId + installationId, or customerId.', 'click_id');
        }
        $body = array_filter([
            'click_id' => $params['clickId'] ?? null,
            'app_id' => $appId,
            'installation_id' => $installationId,
            'customer_id' => $params['customerId'] ?? null,
            'label' => $params['label'] ?? null,
        ], static fn(mixed $v): bool => null !== $v);
        if ($this->core->guardState()[0]) {
            Guard::check('identify', $body);
        }
        [, $data] = $this->core->requester->request((new ApiRequest('POST', '/v1/people/identify'))->withBody($body)->withOptions($requestOptions));

        return Links::arr($data);
    }

    /**
     * The organisation's server SDK config (private mode, click-ID parameter, goals), cached for 10 minutes.
     * Null when it can't be loaded.
     *
     * ```php
     * $config = $clikgate->config();
     * if ($config['private_mode'] ?? false) { echo 'private mode is on'; }
     * ```
     *
     * @return array<string, mixed>|null
     */
    public function config(): ?array
    {
        return $this->core->config();
    }

    /**
     * Send everything queued now. Returns true when done within `$timeout` seconds. Never throws.
     *
     * ```php
     * $clikgate->flush();   // e.g. at the end of a queue worker job
     * ```
     */
    public function flush(float $timeout = 10.0): bool
    {
        try {
            return $this->queue->drain($timeout);
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Flush, then refuse later `goal()` calls (`client_closed` to `onError`).
     *
     * ```php
     * $clikgate->close();
     * ```
     */
    public function close(float $timeout = 10.0): bool
    {
        $this->closed = true;

        return $this->flush($timeout);
    }

    /** @internal Shutdown flush (SPEC 9.4); `after_response` first lets the visitor go. */
    public function onShutdown(): void
    {
        if (0 === $this->queue->size()) {
            return;
        }
        if ('after_response' === $this->sendMode && \function_exists('fastcgi_finish_request')) {
            fastcgi_finish_request();
        }
        $this->flush(5.0);
    }

    private function registerShutdown(): void
    {
        if ($this->shutdownRegistered || !$this->shutdownHooks) {
            return;
        }
        $this->shutdownRegistered = true;
        $self = \WeakReference::create($this);
        register_shutdown_function(static function () use ($self): void {
            $self->get()?->onShutdown();
        });
    }

    public function __destruct()
    {
        if (!$this->closed && $this->shutdownHooks && $this->queue->size() > 0) {
            $this->onShutdown();
        }
    }

    private static function transport(mixed $httpClient, string|false|null $proxy): Transport
    {
        if (null !== $httpClient) {
            if (!$httpClient instanceof ClientInterface) {
                throw self::invalid('httpClient', 'httpClient must be a PSR-18 Psr\Http\Client\ClientInterface.');
            }

            return new Psr18Transport($httpClient, Psr17FactoryDiscovery::findRequestFactory(), Psr17FactoryDiscovery::findStreamFactory());
        }
        if (\extension_loaded('curl')) {
            return new CurlTransport($proxy);
        }
        try {
            return new Psr18Transport(Psr18ClientDiscovery::find(), Psr17FactoryDiscovery::findRequestFactory(), Psr17FactoryDiscovery::findStreamFactory());
        } catch (\Throwable) {
            throw self::invalid('httpClient', 'No HTTP client: enable ext-curl, or install a PSR-18 client (e.g. composer require guzzlehttp/guzzle).');
        }
    }

    /**
     * @param array<string, mixed> $options
     */
    private static function number(array $options, string $name, int|float $default, int|float $min, int|float $max, bool $integer): int|float
    {
        if (!\array_key_exists($name, $options)) {
            return $default;
        }
        $v = $options[$name];
        $ok = $integer ? \is_int($v) : (\is_int($v) || \is_float($v));
        if (!$ok || $v < $min || $v > $max) {
            throw self::invalid($name, \sprintf('%s must be a number from %s to %s.', $name, $min, $max));
        }

        return $integer ? (int) $v : (float) $v;
    }

    private static function invalid(string $param, string $message): ConfigurationException
    {
        return new ConfigurationException($message, 'invalid_option', param: $param);
    }

    private static function keyType(string $k): string
    {
        return match (true) {
            str_starts_with($k, 'cg_sdk_') => 'a mobile SDK key (cg_sdk_…)',
            str_starts_with($k, 'cg_site_') => 'a web script site key (cg_site_…)',
            str_starts_with($k, 'cg_cli_') => 'a setup command token (cg_cli_…)',
            default => 'not a Clikgate server API key',
        };
    }

    /** @internal for the add-ons */
    public function core(): Core
    {
        return $this->core;
    }

    /** @internal */
    public static function canonicalName(ClikgateException $e): string
    {
        return Core::canonical($e);
    }
}
