<?php

declare(strict_types=1);

namespace Clikgate\Http;

use Clikgate\Exception\ClikgateException;
use Clikgate\Exception\ClikgateNetworkException;
use Clikgate\Exception\ClikgateTimeoutException;
use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\RateLimitException;
use Clikgate\Exception\ServerException;

/**
 * @internal The one HTTP pipeline every call (hand-written and generated) goes through: headers, retries
 * with full-jitter backoff, `Retry-After`, idempotency keys and typed errors (SPEC sections 4, 6, 7).
 */
final class Requester
{
    private const BACKOFF_BASE_MS = 500;
    private const BACKOFF_CAP_MS = 20_000;
    private const MAX_RETRY_AFTER_MS = 60_000;
    public const RETRYABLE_STATUS = [429, 500, 502, 503, 504];

    /** @var \Closure(): float */
    private \Closure $random;

    /**
     * @param callable(): float $random
     */
    public function __construct(
        private readonly string $apiKey,
        private readonly string $baseUrl,
        private readonly float $timeout,
        private readonly int $maxRetries,
        private readonly string $userAgent,
        private readonly Transport $transport,
        public readonly Clock $clock,
        callable $random,
    ) {
        $this->random = \Closure::fromCallable($random);
    }

    public function nowMs(): int
    {
        return $this->clock->nowMs();
    }

    /** Full-jitter backoff for retry number `$n` (0-based). */
    public function backoffMs(int $n): int
    {
        return (int) floor(($this->random)() * min(self::BACKOFF_CAP_MS, self::BACKOFF_BASE_MS * 2 ** $n));
    }

    /**
     * Send a JSON request and parse the JSON answer (null for an empty body).
     *
     * @return array{0: int, 1: mixed, 2: array<string, string>}
     */
    public function request(ApiRequest $req): array
    {
        $res = $this->send($req);

        return [$res->status, $res->json(), $res->headers];
    }

    /** Send a request; returns the 2xx response or throws a typed exception (after retries). */
    public function send(ApiRequest $req): RawResponse
    {
        $url = $this->baseUrl . $req->path . self::queryString($req->query);
        $headers = [
            'Authorization' => "Bearer {$this->apiKey}",
            'User-Agent' => $this->userAgent,
            'Accept' => 'application/json',
        ];
        $body = null;
        if ($req->hasBody) {
            $body = self::toJson($req->body);
            $headers['Content-Type'] = 'application/json';
        }
        if ('POST' === $req->method || 'PATCH' === $req->method) {
            $headers['Idempotency-Key'] = $req->idempotencyKey ?? self::uuid4();
        }
        $maxRetries = $req->maxRetries ?? $this->maxRetries;
        $timeout = $req->timeout ?? $this->timeout;
        for ($attempt = 0; ; ++$attempt) {
            try {
                $res = $this->transport->send($req->method, $url, $headers, $body, $timeout);
            } catch (ClikgateNetworkException|ClikgateTimeoutException $e) {
                if ($attempt >= $maxRetries) {
                    throw $e;
                }
                $this->clock->sleepMs($this->backoffMs($attempt));
                continue;
            }
            if ($res->status >= 200 && $res->status < 300) {
                return $res;
            }
            $error = ErrorMapper::fromResponse($res->status, $res->headers, $res->body, $this->clock->nowMs());
            if (!\in_array($res->status, self::RETRYABLE_STATUS, true)) {
                throw $error;
            }
            $delay = $this->backoffMs($attempt);
            if (429 === $res->status || 503 === $res->status) {
                $ra = ErrorMapper::retryAfterMs($res->headers, $this->clock->nowMs());
                if (null !== $ra) {
                    if ($ra > self::MAX_RETRY_AFTER_MS) {
                        throw $error;
                    }
                    $delay = $ra;
                }
            }
            if ($attempt >= $maxRetries) {
                throw $error;
            }
            $this->clock->sleepMs($delay);
        }
    }

    /** Whether the exception class is retryable at the batch level (SPEC 9.3). */
    public static function isRetryable(\Throwable $e): bool
    {
        if ($e instanceof ClikgateNetworkException || $e instanceof ClikgateTimeoutException || $e instanceof RateLimitException) {
            return true;
        }

        return $e instanceof ServerException && \in_array($e->getHttpStatus(), self::RETRYABLE_STATUS, true);
    }

    /** Percent-encode one path segment (RFC 3986 unreserved characters kept). */
    public static function encodePathSegment(string $s): string
    {
        return rawurlencode($s);
    }

    /**
     * Fill `{name}` placeholders with encoded values (used by the generated layer).
     *
     * @param array<string, string|int> $params
     */
    public static function path(string $template, array $params): string
    {
        foreach ($params as $k => $v) {
            $template = str_replace('{' . $k . '}', self::encodePathSegment(self::requireId($v, $k)), $template);
        }

        return $template;
    }

    public static function requireId(mixed $value, string $name = 'id'): string
    {
        if (\is_int($value)) {
            return (string) $value;
        }
        if (!\is_string($value) || '' === $value) {
            throw ErrorMapper::local('invalid_argument', "{$name} must be a non-empty string.", $name);
        }

        return $value;
    }

    /** RFC 3339 UTC (`YYYY-MM-DDTHH:MM:SSZ`, with `.sss` only when the milliseconds aren't zero); strings pass through. */
    public static function formatDate(\DateTimeInterface|string $d): string
    {
        if (\is_string($d)) {
            return $d;
        }
        $u = \DateTimeImmutable::createFromInterface($d)->setTimezone(new \DateTimeZone('UTC'));
        $ms = (int) $u->format('v');

        return $u->format('Y-m-d\TH:i:s') . ($ms > 0 ? \sprintf('.%03dZ', $ms) : 'Z');
    }

    /**
     * @param array<string, mixed> $query
     */
    public static function queryString(array $query): string
    {
        $parts = [];
        foreach ($query as $k => $v) {
            if (\is_array($v) && [] !== $v && !array_is_list($v)) {
                // A map (e.g. 'metadata' => ['seller_id' => 'sel_ada']) is sent as metadata[seller_id]=sel_ada (SPEC section 21).
                foreach ($v as $sub => $sv) {
                    if (null !== $sv) {
                        $parts[] = rawurlencode($k . '[' . $sub . ']') . '=' . rawurlencode(self::scalar($sv));
                    }
                }
                continue;
            }
            foreach (\is_array($v) && array_is_list($v) ? $v : [$v] as $item) {
                if (null === $item) {
                    continue;
                }
                $parts[] = rawurlencode((string) $k) . '=' . rawurlencode(self::scalar($item));
            }
        }

        return [] === $parts ? '' : '?' . implode('&', $parts);
    }

    private static function scalar(mixed $v): string
    {
        return match (true) {
            \is_bool($v) => $v ? 'true' : 'false',
            $v instanceof \DateTimeInterface => self::formatDate($v),
            \is_scalar($v), $v instanceof \Stringable => (string) $v,
            default => (string) json_encode($v),
        };
    }

    /** UTF-8 JSON. Explicit nulls are kept (PATCH uses them to clear a field); an empty top-level array is `{}`. */
    public static function toJson(mixed $body): string
    {
        $normalised = self::normalise($body);
        if ([] === $normalised) {
            $normalised = new \stdClass();
        }

        return json_encode($normalised, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES | \JSON_UNESCAPED_UNICODE | \JSON_PRESERVE_ZERO_FRACTION);
    }

    private static function normalise(mixed $v): mixed
    {
        if ($v instanceof \DateTimeInterface) {
            return self::formatDate($v);
        }
        if (\is_array($v)) {
            return array_map(self::normalise(...), $v);
        }

        return $v;
    }

    public static function uuid4(): string
    {
        $b = random_bytes(16);
        $b[6] = \chr((\ord($b[6]) & 0x0F) | 0x40);
        $b[8] = \chr((\ord($b[8]) & 0x3F) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($b), 4));
    }

    /** @internal */
    public function asException(\Throwable $e): ClikgateException
    {
        return ErrorMapper::wrap($e);
    }
}
