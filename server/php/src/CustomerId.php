<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ConfigurationException;

/**
 * Your customer IDs in one canonical form (change 26 KC.1, R.24), the form the API stores and checks:
 * Unicode NFC, trimmed of Unicode whitespace (and U+FEFF) at both ends, case kept.
 *
 * Warnings (first match wins): `empty`, `too_long` (more than 128 characters), `looks_like_email`,
 * `looks_like_national_id` (exactly 11 digits, unless `allow11DigitIds`), `looks_like_phone`.
 * Use your own stable user ID (for example `u_10482`), never an email, phone number, BVN or NIN.
 *
 * NFC needs the `intl` extension for IDs with non-ASCII characters (ASCII IDs are already NFC).
 *
 * ```php
 * use Clikgate\CustomerId;
 * CustomerId::warning('ada@example.com'); // 'looks_like_email'
 * ```
 */
final class CustomerId
{
    /** The longest customer ID kept as a known customer, in Unicode code points. */
    public const MAX_LENGTH = 128;

    /** Unicode White_Space characters plus U+FEFF (the byte-order mark), as a PCRE class. */
    private const TRIM = '[\x{0009}-\x{000D}\x{0020}\x{0085}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]';

    private function __construct() {}

    /**
     * The canonical form of a customer ID: NFC, trimmed, case kept.
     *
     * @throws ConfigurationException `intl_required` for a non-ASCII ID without the intl extension
     * @throws \Clikgate\Exception\InvalidRequestException `invalid_customer_id` for invalid UTF-8
     */
    public static function canonical(string $customerId): string
    {
        if (1 !== preg_match('//u', $customerId)) {
            throw Exception\ErrorMapper::local('invalid_customer_id', 'customerId must be valid UTF-8.', 'customer_id');
        }
        $s = $customerId;
        if (1 === preg_match('/[^\x00-\x7F]/', $s)) {
            if (!class_exists(\Normalizer::class)) {
                throw new ConfigurationException('Customer IDs with non-ASCII characters need the PHP intl extension (Unicode NFC).', 'intl_required');
            }
            $normalized = \Normalizer::normalize($s, \Normalizer::FORM_C);
            $s = \is_string($normalized) ? $normalized : $s;
        }

        return (string) preg_replace('/^' . self::TRIM . '+|' . self::TRIM . '+$/u', '', $s);
    }

    /**
     * Why Clikgate wouldn't keep this ID as a known customer, or null when it's fine.
     *
     * @return 'empty'|'too_long'|'looks_like_email'|'looks_like_national_id'|'looks_like_phone'|null
     */
    public static function warning(string $customerId, bool $allow11DigitIds = false): ?string
    {
        $cid = self::canonical($customerId);
        if ('' === $cid) {
            return 'empty';
        }
        if ((int) preg_match_all('/./su', $cid) > self::MAX_LENGTH) {
            return 'too_long';
        }
        $at = strpos($cid, '@');
        if (false !== $at && str_contains(substr($cid, $at + 1), '.')) {
            return 'looks_like_email';
        }
        if (1 === preg_match('/^[0-9]{11}$/D', $cid)) {
            return $allow11DigitIds ? null : 'looks_like_national_id';
        }
        if (1 === preg_match('/^\+?[0-9]{10,15}$/D', str_replace([' ', '-'], '', $cid))) {
            return 'looks_like_phone';
        }

        return null;
    }
}
