<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\InvalidRequestException;

/**
 * Hashed email and phone for ad network matching. The values Clikgate accepts as
 * `hashed_email`, `hashed_phone_e164` and `hashed_phone_digits`: SHA-256 as 64 lowercase hex characters.
 */
final class HashForAds
{
    /** @internal The goal options and their wire fields. */
    public const FIELDS = ['hashedEmail' => 'hashed_email', 'hashedPhoneE164' => 'hashed_phone_e164', 'hashedPhoneDigits' => 'hashed_phone_digits'];

    private function __construct() {}

    /**
     * Normalise and hash an email and / or phone on your own server, for a goal's ad network matching. Pure and
     * offline: no client needed. In private mode Clikgate never hashes for you: hash on your own server with this
     * helper and send only the hashes. A null argument gives no field.
     *
     * - email: trimmed and lowercased; it must contain `@`.
     * - phone: must include its country code (start with `+` or `00`); spaces and punctuation are removed, and the
     *   result must be 7-15 digits starting with 1-9. A national number such as `0803 123 4567` is refused.
     *
     * ```php
     * $clikgate->goal('account_opened', [
     *     'reference' => 'APP-55231',
     *     'clickId' => $clickId,
     * ] + HashForAds::hash($customer->email, $customer->phone)); // e.g. '+234 803 123 4567'
     * ```
     *
     * @return array{hashedEmail?: string, hashedPhoneE164?: string, hashedPhoneDigits?: string} goal options, only
     *                                                                                          for the values given
     *
     * @throws InvalidRequestException `invalid_argument` (param `email` or `phone`); the input is never in the message
     */
    public static function hash(?string $email = null, ?string $phone = null): array
    {
        $out = [];
        if (null !== $email) {
            $trimmed = self::trim($email);
            $value = null === $trimmed ? '' : mb_strtolower($trimmed, 'UTF-8');
            if (!str_contains($value, '@')) {
                throw ErrorMapper::local('invalid_argument', 'email must be an email address (it contains @).', 'email');
            }
            $out['hashedEmail'] = hash('sha256', $value);
        }
        if (null !== $phone) {
            $trimmed = self::trim($phone) ?? '';
            $digits = (string) preg_replace('/[^0-9]/', '', $trimmed);
            if (str_starts_with($trimmed, '00')) {
                $digits = substr($digits, 2);
            } elseif (!str_starts_with($trimmed, '+')) {
                $digits = '';
            }
            if (1 !== preg_match('/^[1-9][0-9]{6,14}$/D', $digits)) {
                throw ErrorMapper::local('invalid_argument', 'phone must include its country code, e.g. "+234 803 123 4567" (7-15 digits after the +).', 'phone');
            }
            $out['hashedPhoneE164'] = hash('sha256', '+' . $digits);
            $out['hashedPhoneDigits'] = hash('sha256', $digits);
        }

        return $out;
    }

    /**
     * @internal Refuse a hashed wire field that isn't 64 lowercase hex characters (the value is never echoed).
     *
     * @param array<array-key, mixed> $wire
     *
     * @throws InvalidRequestException `invalid_hashed_identifier`
     */
    public static function checkFields(array $wire): void
    {
        foreach (self::FIELDS as $field) {
            $v = $wire[$field] ?? null;
            if (null === $v) {
                continue;
            }
            if (!\is_string($v) || 1 !== preg_match('/^[0-9a-f]{64}$/D', $v)) {
                throw ErrorMapper::local('invalid_hashed_identifier', \sprintf('%s must be a SHA-256 hash as 64 lowercase hex characters (use HashForAds::hash).', $field), $field);
            }
        }
    }

    /** Unicode whitespace at both ends; null for a string that isn't valid UTF-8. */
    private static function trim(string $value): ?string
    {
        return preg_replace('/^[\s\p{Z}]+|[\s\p{Z}]+$/u', '', $value);
    }
}
