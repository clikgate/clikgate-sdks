<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\SignatureVerificationException;

/**
 * Webhook verification (`Clikgate-Signature`). No API key or client needed: `Webhooks::verify(...)`.
 *
 * `Clikgate-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]` with
 * `hex = HMAC-SHA256(key = the whole secret including "whsec_", message = "<t>." + raw body)`.
 */
final class Webhooks
{
    /**
     * Verify a delivery and return the parsed event. Throws SignatureVerificationException.
     *
     * `$tolerance` is the maximum age (and future skew) in seconds; 0 disables the check (tests only).
     *
     * ```php
     * $event = Webhooks::verify(file_get_contents('php://input'), $_SERVER['HTTP_CLIKGATE_SIGNATURE'] ?? null, getenv('CLIKGATE_WEBHOOK_SECRET'));
     * if ('goal.completed' === $event['type']) { … }   // dedupe on $event['id']: delivery is at-least-once
     * ```
     *
     * @return array<string, mixed> the event
     */
    public static function verify(mixed $rawBody, ?string $signatureHeader, string $secret, int $tolerance = 300, ?int $now = null): array
    {
        if ('' === $secret) {
            throw ErrorMapper::local('invalid_argument', 'secret must be the endpoint secret (whsec_…).', 'secret');
        }

        return self::check($rawBody, $signatureHeader, [$secret], $tolerance, $now);
    }

    /**
     * Like verify(), accepting any of several secrets (while you rotate your own).
     *
     * ```php
     * $event = Webhooks::verifyAny($body, $header, [$newSecret, $oldSecret]);
     * ```
     *
     * @param list<string> $secrets
     *
     * @return array<string, mixed>
     */
    public static function verifyAny(mixed $rawBody, ?string $signatureHeader, array $secrets, int $tolerance = 300, ?int $now = null): array
    {
        if ([] === $secrets || \in_array('', $secrets, true)) {
            throw ErrorMapper::local('invalid_argument', 'secrets must be a non-empty list of endpoint secrets.', 'secrets');
        }

        return self::check($rawBody, $signatureHeader, $secrets, $tolerance, $now);
    }

    /**
     * @param list<string> $secrets
     *
     * @return array<string, mixed>
     */
    private static function check(mixed $rawBody, ?string $header, array $secrets, int $tolerance, ?int $now): array
    {
        if (!\is_string($rawBody)) {
            throw self::fail('invalid_payload', 'Pass the raw request body (a string), not parsed JSON: re-serialising changes the bytes Clikgate signed.');
        }
        if (null === $header || '' === trim($header)) {
            throw self::fail('missing_signature', 'The Clikgate-Signature header is missing.');
        }
        $t = null;
        $bad = false;
        $v1 = [];
        foreach (explode(',', $header) as $part) {
            $p = trim($part);
            $eq = strpos($p, '=');
            if (false === $eq) {
                continue;
            }
            $key = trim(substr($p, 0, $eq));
            $value = trim(substr($p, $eq + 1));
            if ('t' === $key) {
                if (1 === preg_match('/^[0-9]+$/D', $value)) {
                    $t = (int) $value;
                } else {
                    $bad = true;
                }
            } elseif ('v1' === $key) {
                $v1[] = $value;
            }
        }
        if ($bad || null === $t || [] === $v1) {
            throw self::fail('malformed_signature', 'The Clikgate-Signature header is malformed (expected t=<unix seconds>,v1=<hex>).');
        }
        $current = $now ?? time();
        if ($tolerance > 0 && abs($current - $t) > $tolerance) {
            throw self::fail('timestamp_outside_tolerance', "The signature timestamp is more than {$tolerance} s from now; the request may be a replay, or this server's clock is wrong.");
        }
        $matched = false;
        foreach ($secrets as $secret) {
            $expected = hash_hmac('sha256', "{$t}." . $rawBody, $secret);
            foreach ($v1 as $candidate) {
                if (\strlen($candidate) === \strlen($expected) && hash_equals($expected, $candidate)) {
                    $matched = true;
                }
            }
        }
        if (!$matched) {
            throw self::fail('no_matching_signature', 'No signature matches: check the endpoint secret, and that you pass the raw body.');
        }
        try {
            $event = json_decode($rawBody, true, 512, \JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw self::fail('invalid_payload', 'The body is not JSON.');
        }
        if (!\is_array($event) || (array_is_list($event) && [] !== $event)) {
            throw self::fail('invalid_payload', 'The body is not an event object.');
        }

        /** @var array<string, mixed> $event */
        return $event;
    }

    private static function fail(string $code, string $message): SignatureVerificationException
    {
        return new SignatureVerificationException($message, $code);
    }
}
