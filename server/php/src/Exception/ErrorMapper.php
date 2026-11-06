<?php

declare(strict_types=1);

namespace Clikgate\Exception;

/** @internal Map HTTP responses to typed exceptions (SPEC 5, rules 3-13). */
final class ErrorMapper
{
    private const SNIPPET = 200;

    /**
     * @param array<string, string> $headers lowercase names
     */
    public static function fromResponse(int $status, array $headers, string $body, int $nowMs): ClikgateException
    {
        $envelope = null;
        try {
            $parsed = json_decode($body, true, 512, \JSON_THROW_ON_ERROR);
            if (\is_array($parsed) && isset($parsed['error']) && \is_array($parsed['error'])) {
                /** @var array<string, mixed> $envelope */
                $envelope = $parsed['error'];
            }
        } catch (\JsonException) {
            $envelope = null;
        }
        $str = static fn(string $k): ?string => isset($envelope[$k]) && \is_string($envelope[$k]) ? $envelope[$k] : null;
        $requestId = $str('request_id') ?? ($headers['x-request-id'] ?? null);
        $redirect = $status >= 300 && $status < 400;
        $bodyCode = $str('code');
        $code = $redirect ? 'unexpected_status' : ($bodyCode ?? "http_{$status}");
        $message = $str('message');
        if (null === $message) {
            $snippet = (string) preg_replace('/[\x00-\x1f\x7f]/', ' ', mb_substr($body, 0, self::SNIPPET));
            $message = "HTTP {$status}" . ('' !== $body ? ": {$snippet}" : '');
        }
        $param = $str('param');
        $type = $str('type');
        if (429 === $status) {
            return new RateLimitException($message, $bodyCode ?? 'rate_limit_exceeded', $status, $requestId, $param, $type, $envelope, self::retryAfterSeconds($headers, $nowMs));
        }
        if ($status >= 500) {
            return new ServerException($message, $code, $status, $requestId, $param, $type, $envelope, self::retryAfterSeconds($headers, $nowMs));
        }
        if ('private_mode_field_rejected' === $code) {
            return new PrivateModeFieldRejectedException($message, $param ?? 'unknown', $status, $requestId, $type, $envelope);
        }

        return match (true) {
            401 === $status => new AuthenticationException($message, $code, $status, $requestId, $param, $type, $envelope),
            403 === $status => new PermissionException($message, $code, $status, $requestId, $param, $type, $envelope),
            404 === $status => new NotFoundException($message, $code, $status, $requestId, $param, $type, $envelope),
            409 === $status && ('idempotency' === $type || str_starts_with($code, 'idempotency_')) => new IdempotencyException($message, $code, $status, $requestId, $param, $type, $envelope),
            409 === $status && 'link_locked' === $code => new LinkLockedException($message, $code, $status, $requestId, $param, $type, $envelope),
            409 === $status => new ConflictException($message, $code, $status, $requestId, $param, $type, $envelope),
            $status >= 400 => new InvalidRequestException($message, $code, $status, $requestId, $param, $type, $envelope),
            default => new ServerException($message, $code, $status, $requestId, $param, $type, $envelope),
        };
    }

    /** Map a batch item's `{status, error}` to a typed exception. */
    public static function fromBatchItem(int $status, mixed $error): ClikgateException
    {
        return self::fromResponse($status, [], (string) json_encode(['error' => \is_array($error) ? $error : new \stdClass()]), 0);
    }

    /**
     * `Retry-After` in milliseconds (delta-seconds or an HTTP-date against the SDK clock), or null.
     *
     * @param array<string, string> $headers
     */
    public static function retryAfterMs(array $headers, int $nowMs): ?int
    {
        if (!isset($headers['retry-after'])) {
            return null;
        }
        $s = trim($headers['retry-after']);
        if (1 === preg_match('/^[0-9]+$/D', $s)) {
            return (int) $s * 1000;
        }
        $t = \DateTimeImmutable::createFromFormat('D, d M Y H:i:s \G\M\T', $s, new \DateTimeZone('UTC'));
        if (false === $t) {
            $ts = strtotime($s);
            if (false === $ts || 1 !== preg_match('/[A-Za-z]{3},? /', $s)) {
                return null;
            }

            return max(0, $ts * 1000 - $nowMs);
        }

        return max(0, $t->getTimestamp() * 1000 - $nowMs);
    }

    /**
     * @param array<string, string> $headers
     */
    private static function retryAfterSeconds(array $headers, int $nowMs): ?int
    {
        $ms = self::retryAfterMs($headers, $nowMs);

        return null === $ms ? null : (int) ceil($ms / 1000);
    }

    /** A local validation error (no HTTP request was made). */
    public static function local(string $code, string $message, ?string $param = null): InvalidRequestException
    {
        return new InvalidRequestException($message, $code, null, null, $param);
    }

    /** Wrap anything thrown inside a never-throwing path. */
    public static function wrap(\Throwable $e): ClikgateException
    {
        if ($e instanceof ClikgateException) {
            return $e;
        }
        if ($e instanceof \InvalidArgumentException || $e instanceof \TypeError) {
            return new InvalidRequestException($e->getMessage(), 'invalid_value', null, null, null, null, null, $e);
        }

        return new ClikgateException($e->getMessage(), 'unexpected_error', null, null, null, null, null, $e);
    }
}
