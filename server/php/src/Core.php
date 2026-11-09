<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ClikgateException;
use Clikgate\Http\ApiRequest;
use Clikgate\Http\Requester;
use Psr\Log\LoggerInterface;

/**
 * @internal State shared by the resources of one client: logging, `onError`, redaction, and the server SDK
 * config (`GET /v1/server-sdk/config`: single attempt, 10-minute cache, fail closed, 60 s negative cache).
 */
final class Core
{
    public const CONFIG_TTL_MS = 600_000;
    public const CONFIG_RETRY_MS = 60_000;

    /** The API's reason (and error code) for a goal name that isn't set up, while only set-up goals are accepted. */
    public const UNKNOWN_GOAL = 'unknown_goal';

    /** @var array<string, true> */
    private array $warned = [];
    /** @var array<string, mixed>|null */
    private ?array $config = null;
    private int $fetchedAt = 0;
    private ?int $failedAt = null;
    private bool $versionWarned = false;
    /** @var (\Closure(ClikgateException, ErrorContext): void)|null */
    private ?\Closure $onError;

    /**
     * @param 'auto'|bool                                         $privateMode
     * @param (callable(ClikgateException, ErrorContext): void)|null $onError
     */
    public function __construct(
        public readonly Requester $requester,
        public readonly LoggerInterface $logger,
        public readonly string|bool $privateMode,
        private readonly float $configTimeout,
        ?callable $onError,
    ) {
        $this->onError = null === $onError ? null : \Closure::fromCallable($onError);
    }

    /** Warn with a stable code. With `$onceKey`, at most once per client for that key. */
    public function warn(string $code, string $message, ?string $onceKey = null): void
    {
        if (null !== $onceKey) {
            $k = "{$code}:{$onceKey}";
            if (isset($this->warned[$k])) {
                return;
            }
            $this->warned[$k] = true;
        }
        $this->logger->warning($message, ['clikgate_code' => $code]);
    }

    /** @return array<string, mixed>|null */
    public function peekConfig(): ?array
    {
        return $this->config;
    }

    /**
     * The config, fetched when the cache is empty or stale; null when unavailable.
     *
     * @return array<string, mixed>|null
     */
    public function config(): ?array
    {
        $now = $this->requester->nowMs();
        if (null !== $this->config && $now - $this->fetchedAt < self::CONFIG_TTL_MS) {
            return $this->config;
        }
        if (null !== $this->failedAt && $now - $this->failedAt < self::CONFIG_RETRY_MS) {
            return null;
        }
        try {
            $req = new ApiRequest('GET', '/v1/server-sdk/config');
            $req->maxRetries = 0;
            $req->timeout = min($this->configTimeout, 5.0);
            [, $data] = $this->requester->request($req);
            if (!\is_array($data) || !\is_bool($data['private_mode'] ?? null)) {
                throw new \UnexpectedValueException('unexpected config body');
            }
            /** @var array<string, mixed> $data */
            $this->config = $data;
            $this->fetchedAt = $this->requester->nowMs();
            $this->failedAt = null;
            $minimum = \is_array($data['minimum_sdk_versions'] ?? null) ? ($data['minimum_sdk_versions']['php'] ?? null) : null;
            if (!$this->versionWarned && \is_string($minimum) && self::semverLess(Version::VERSION, $minimum)) {
                $this->versionWarned = true;
                $this->logger->warning(\sprintf('clikgate/clikgate-php %s is below the minimum version %s for your organisation. Please upgrade.', Version::VERSION, $minimum), ['clikgate_code' => 'sdk_below_minimum_version']);
            }

            return $data;
        } catch (\Throwable $e) {
            $this->config = null;
            $this->failedAt = $this->requester->nowMs();
            $why = $e instanceof ClikgateException ? $e->getErrorCode() : 'error';
            $this->logger->warning("Could not load the server SDK config ({$why}); the private-mode guard stays on until it loads.", ['clikgate_code' => 'config_unavailable']);

            return null;
        }
    }

    /**
     * The guard state: [guard on?, the loaded config or null].
     *
     * @return array{0: bool, 1: array<string, mixed>|null}
     */
    public function guardState(): array
    {
        if (true === $this->privateMode) {
            return [true, null];
        }
        if (false === $this->privateMode) {
            return [false, null];
        }
        $config = $this->config();

        return [null === $config || true === $config['private_mode'], $config];
    }

    /** Whether the guard is (or may be) on right now, without fetching: used for redaction. */
    public function mayBePrivate(): bool
    {
        if (\is_bool($this->privateMode)) {
            return $this->privateMode;
        }

        return null === $this->config || true === $this->config['private_mode'];
    }

    public function shownReference(mixed $reference): string
    {
        if ($this->mayBePrivate()) {
            return Guard::REDACTED;
        }

        return \is_scalar($reference) ? (string) $reference : '';
    }

    /**
     * A goal the API refused because the organisation accepts only goals it has set up (`unknown_goal`): one line at
     * debug level (the PSR-3 logger decides whether debug is on). The goal name only: never the reference, customer
     * ID, values or labels. The SDK never checks names itself and never remembers the refusal. Never throws.
     */
    public function noteRefusedGoal(mixed $goal, mixed $codeOrReason): void
    {
        if (self::UNKNOWN_GOAL !== $codeOrReason || !\is_string($goal)) {
            return;
        }
        try {
            $this->logger->debug("Goal `{$goal}` isn't set up in Clikgate", ['clikgate_code' => self::UNKNOWN_GOAL]);
        } catch (\Throwable) {
            // a broken logger must not break the caller
        }
    }

    /**
     * `noteRefusedGoal` for each item of a batch result (`$wires[$i]` is the event sent at index `$i`).
     *
     * @param list<array<string, mixed>> $wires
     */
    public function noteRefusedItems(array $wires, mixed $data): void
    {
        foreach (\is_array($data) && \is_array($data['data'] ?? null) ? $data['data'] : [] as $item) {
            if (!\is_array($item)) {
                continue;
            }
            $index = $item['index'] ?? null;
            if (!\is_int($index) || !isset($wires[$index])) {
                continue;
            }
            $reason = true === ($item['ok'] ?? false)
                ? (\is_array($item['goal_event'] ?? null) ? ($item['goal_event']['reason'] ?? null) : null)
                : (\is_array($item['error'] ?? null) ? ($item['error']['code'] ?? null) : null);
            $this->noteRefusedGoal($wires[$index]['goal'] ?? null, $reason);
        }
    }

    /** Log at error level and call `onError`. Never throws. */
    public function report(ClikgateException $error, ErrorContext $context): void
    {
        try {
            $who = implode(', ', array_map(static fn(array $e): string => "{$e['goal']}:{$e['reference']}", $context->events));
            $rid = null !== $error->getRequestId() ? ", request {$error->getRequestId()}" : '';
            $this->logger->error(\sprintf('Clikgate %s failed (%s %s%s) for %s%s.', $context->operation, self::canonical($error), $error->getErrorCode(), $rid, '' !== $who ? $who : 'no events', $context->dropped ? '; dropped' : ''), ['clikgate_code' => $error->getErrorCode()]);
        } catch (\Throwable) {
            // a broken logger must not break the caller
        }
        if (null === $this->onError) {
            return;
        }
        try {
            ($this->onError)($error, $context);
        } catch (\Throwable $e) {
            try {
                $this->logger->error('onError threw: ' . $e->getMessage());
            } catch (\Throwable) {
            }
        }
    }

    /** The canonical (Node) class name of an SDK exception (SPEC section 2). */
    public static function canonical(\Throwable $e): string
    {
        $short = substr((string) strrchr('\\' . $e::class, '\\'), 1);

        return match ($short) {
            'ClikgateTimeoutException' => 'TimeoutError',
            'ClikgateNetworkException' => 'NetworkError',
            'ClikgateException' => 'ClikgateError',
            default => str_ends_with($short, 'Exception') && str_starts_with($e::class, 'Clikgate\\') ? substr($short, 0, -9) . 'Error' : $short,
        };
    }

    public static function semverLess(string $a, string $b): bool
    {
        $parse = static function (string $v): array {
            $core = preg_split('/[-+]/', $v, 2)[0] ?? '';
            $out = [];
            foreach (\array_slice(explode('.', $core), 0, 3) as $p) {
                $out[] = 1 === preg_match('/^[0-9]+/', $p, $m) ? (int) $m[0] : 0;
            }

            return array_pad($out, 3, 0);
        };

        return $parse($a) < $parse($b);
    }
}
