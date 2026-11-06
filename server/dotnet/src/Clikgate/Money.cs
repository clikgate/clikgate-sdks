using System;
using System.Globalization;
using System.Text.RegularExpressions;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>
/// A money amount in normal units (₦2,000,000 is <c>2000000</c>, never kobo), always sent as a decimal string
/// (SPEC section 8). Converts implicitly from <see cref="decimal"/>, <see cref="long"/>, <see cref="int"/> and a
/// decimal <see cref="string"/>; there is deliberately no <c>double</c> or <c>float</c> conversion.
/// </summary>
/// <example><code>new GoalOptions { Reference = "APP-55231", Value = 2_000_000m }</code></example>
public readonly struct MoneyValue : IEquatable<MoneyValue>
{
    private readonly object _value;

    private MoneyValue(object value) => _value = value;

    /// <summary>The wire string.</summary>
    public string Wire => Money.FormatObject(_value);

    /// <summary>From a decimal (scale kept: <c>1500.50m</c> → <c>"1500.50"</c>).</summary>
    public static implicit operator MoneyValue(decimal value) => new(value);

    /// <summary>From an integer amount.</summary>
    public static implicit operator MoneyValue(long value) => new(value);

    /// <summary>From an integer amount.</summary>
    public static implicit operator MoneyValue(int value) => new((long)value);

    /// <summary>From a decimal string like <c>"1500.50"</c>.</summary>
    public static implicit operator MoneyValue(string value) => new(value);

    /// <summary>From a decimal.</summary>
    public static MoneyValue FromDecimal(decimal value) => new(value);

    /// <summary>From an integer.</summary>
    public static MoneyValue FromInt64(long value) => new(value);

    /// <summary>From a decimal string.</summary>
    public static MoneyValue FromString(string value) => new(value);

    /// <inheritdoc/>
    public bool Equals(MoneyValue other) => Equals(_value, other._value);

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is MoneyValue m && Equals(m);

    /// <inheritdoc/>
    public override int GetHashCode() => _value?.GetHashCode() ?? 0;

    /// <summary>Equality.</summary>
    public static bool operator ==(MoneyValue left, MoneyValue right) => left.Equals(right);

    /// <summary>Inequality.</summary>
    public static bool operator !=(MoneyValue left, MoneyValue right) => !left.Equals(right);

    /// <inheritdoc/>
    public override string ToString() => Convert.ToString(_value, CultureInfo.InvariantCulture) ?? string.Empty;
}

/// <summary>Money formatting (SPEC section 8).</summary>
public static class Money
{
    private static readonly Regex DecimalPattern = new("^[0-9]+(\\.[0-9]+)?$", RegexOptions.CultureInvariant);

    /// <summary>A decimal in plain notation with its scale kept (<c>1500.50m</c> → <c>"1500.50"</c>).</summary>
    /// <example><code>Money.FormatValue(2_000_000m); // "2000000"</code></example>
    /// <exception cref="InvalidRequestException"><c>invalid_value</c> for negative values.</exception>
    public static string FormatValue(decimal value) => value < 0 ? throw Bad("must not be negative") : value.ToString(CultureInfo.InvariantCulture);

    /// <summary>An integer amount as its digits.</summary>
    /// <example><code>Money.FormatValue(2_000_000L); // "2000000"</code></example>
    public static string FormatValue(long value) => value < 0 ? throw Bad("must not be negative") : value.ToString(CultureInfo.InvariantCulture);

    /// <summary>A decimal string, trimmed; it must look like <c>2000000</c> or <c>1500.50</c> (no signs, exponents or separators).</summary>
    /// <example><code>Money.FormatValue("1500.50"); // "1500.50"</code></example>
    public static string FormatValue(string value)
    {
        var s = (value ?? string.Empty).Trim();
        return DecimalPattern.IsMatch(s) ? s : throw Bad("must be a non-negative decimal number");
    }

    internal static string FormatObject(object? value) => value switch
    {
        decimal d => FormatValue(d),
        long l => FormatValue(l),
        int i => FormatValue(i),
        string s => FormatValue(s),
        null => throw Bad("is missing"),
        _ => throw new ArgumentException("value must be a decimal, long or decimal string, not " + value.GetType().Name + ": floating-point types can't hold exact amounts."),
    };

    private static InvalidRequestException Bad(string why) => Errors.Local("invalid_value", "value " + why + ". Pass a decimal in normal units, like 1500.50m.", "value");
}
