<?php

declare(strict_types=1);

namespace Clikgate;

/**
 * ISO 4217 minor-unit exponents and exact minor-unit to normal-unit conversion (SPEC section 28). No float is
 * ever involved.
 */
final class Currency
{
    /** Exponents other than 2 (the backend's ISO 4217 list); every other code has 2. */
    private const EXPONENTS = [
        'BHD' => 3, 'BIF' => 0, 'CLF' => 4, 'CLP' => 0, 'DJF' => 0, 'GNF' => 0, 'IQD' => 3, 'ISK' => 0, 'JOD' => 3,
        'JPY' => 0, 'KMF' => 0, 'KRW' => 0, 'KWD' => 3, 'LYD' => 3, 'OMR' => 3, 'PYG' => 0, 'RWF' => 0, 'TND' => 3,
        'UGX' => 0, 'UYI' => 0, 'UYW' => 4, 'VND' => 0, 'VUV' => 0, 'XAF' => 0, 'XOF' => 0, 'XPF' => 0,
    ];

    /** The currency's ISO 4217 exponent (2 when unknown); matched case-insensitively. */
    public static function exponent(string $currency): int
    {
        return self::EXPONENTS[strtoupper($currency)] ?? 2;
    }

    /**
     * Minor units to a decimal string in normal units, with exactly the currency's exponent of fraction digits.
     *
     * ```php
     * Currency::minorToAmount(50000, 'NGN'); // '500.00'
     * Currency::minorToAmount(1500, 'JPY');  // '1500'
     * ```
     */
    public static function minorToAmount(int $amountMinor, string $currency): string
    {
        $exp = self::exponent($currency);
        $negative = $amountMinor < 0;
        $digits = ltrim((string) $amountMinor, '-');
        $digits = str_pad($digits, $exp + 1, '0', \STR_PAD_LEFT);
        $whole = 0 === $exp ? $digits : substr($digits, 0, -$exp) . '.' . substr($digits, -$exp);

        return $negative ? '-' . $whole : $whole;
    }
}
