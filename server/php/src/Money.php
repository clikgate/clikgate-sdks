<?php

declare(strict_types=1);

namespace Clikgate;

use Clikgate\Exception\ErrorMapper;
use Clikgate\Exception\InvalidRequestException;

/** Money (SPEC section 8): `value` is in normal units and always goes on the wire as a decimal string. */
final class Money
{
    /**
     * Format a money value for the wire: always a plain decimal string.
     *
     * - strings are trimmed and must look like `2000000` or `1500.50` (no signs, exponents or separators);
     * - integers are sent as their digits.
     *
     * Floats are refused with `\InvalidArgumentException`: they can't hold exact amounts. The SDK can't see
     * whether the caller uses `declare(strict_types=1)`, so it always applies the strict rule.
     *
     * ```php
     * Money::formatValue('1500.50'); // '1500.50'
     * Money::formatValue(2000000);   // '2000000'
     * ```
     *
     * @throws InvalidRequestException code `invalid_value`
     * @throws \InvalidArgumentException for floats and other types
     */
    public static function formatValue(mixed $value): string
    {
        if (\is_string($value)) {
            $s = trim($value);
            if (1 !== preg_match('/^[0-9]+(\.[0-9]+)?$/D', $s)) {
                throw self::bad('must be a non-negative decimal number');
            }

            return $s;
        }
        if (\is_int($value)) {
            if ($value < 0) {
                throw self::bad('must not be negative');
            }

            return (string) $value;
        }
        if (\is_float($value)) {
            throw new \InvalidArgumentException("value must be a string or int, not float: floats can't hold exact amounts. Pass a decimal string, like '1500.50'.");
        }
        throw new \InvalidArgumentException('value must be a string or int, not ' . get_debug_type($value) . '.');
    }

    private static function bad(string $why): InvalidRequestException
    {
        return ErrorMapper::local('invalid_value', "value {$why}. Pass a decimal string in normal units, like '1500.50'.", 'value');
    }
}
