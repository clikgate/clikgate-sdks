using System;
using System.Collections.Generic;

namespace Clikgate.Internal;

/// <summary>ISO 4217 minor-unit exponents, to turn an amount in minor units into normal units.</summary>
internal static class Currencies
{
    private static readonly Dictionary<string, int> NotTwo = new(StringComparer.OrdinalIgnoreCase)
    {
        ["BIF"] = 0,
        ["CLP"] = 0,
        ["DJF"] = 0,
        ["GNF"] = 0,
        ["ISK"] = 0,
        ["JPY"] = 0,
        ["KMF"] = 0,
        ["KRW"] = 0,
        ["PYG"] = 0,
        ["RWF"] = 0,
        ["UGX"] = 0,
        ["UYI"] = 0,
        ["VND"] = 0,
        ["VUV"] = 0,
        ["XAF"] = 0,
        ["XOF"] = 0,
        ["XPF"] = 0,
        ["BHD"] = 3,
        ["IQD"] = 3,
        ["JOD"] = 3,
        ["KWD"] = 3,
        ["LYD"] = 3,
        ["OMR"] = 3,
        ["TND"] = 3,
        ["CLF"] = 4,
        ["UYW"] = 4,
    };

    /// <summary>The currency's exponent (decimal places); 2 for a code this table doesn't list.</summary>
    public static int Exponent(string currency) => NotTwo.TryGetValue(currency, out var e) ? e : 2;

    /// <summary><paramref name="amountMinor"/> in normal units (exact), or null when either is missing.</summary>
    public static decimal? ToNormalUnits(long? amountMinor, string? currency)
    {
        if (amountMinor is not long minor || string.IsNullOrEmpty(currency))
        {
            return null;
        }
        // new decimal(lo, mid, hi, negative, scale) keeps the currency's decimals: 150050 NGN is 1500.50
        var scale = (byte)Exponent(currency!);
        var abs = (ulong)(minor < 0 ? -minor : minor);
        return new decimal((int)(abs & 0xFFFFFFFF), (int)(abs >> 32), 0, minor < 0, scale);
    }
}
