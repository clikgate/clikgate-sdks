using System;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>
/// Hashed email and phone for ad network matching (SPEC 25), from <see cref="HashForAds.Hash(string?, string?)"/>:
/// SHA-256 values as 64 lowercase hex characters, wired as <c>hashed_email</c>, <c>hashed_phone_e164</c> and
/// <c>hashed_phone_digits</c>. A property is null when its input wasn't given. Pass it with
/// <see cref="GoalOptions.WithHashed(HashedIdentifiers?)"/>.
/// </summary>
public sealed class HashedIdentifiers
{
    internal HashedIdentifiers(string? hashedEmail, string? hashedPhoneE164, string? hashedPhoneDigits)
    {
        HashedEmail = hashedEmail;
        HashedPhoneE164 = hashedPhoneE164;
        HashedPhoneDigits = hashedPhoneDigits;
    }

    /// <summary>SHA-256 of the email, trimmed and lowercased, or null.</summary>
    public string? HashedEmail { get; }

    /// <summary>SHA-256 of the phone in E.164 with the <c>+</c> (<c>+2348031234567</c>), or null.</summary>
    public string? HashedPhoneE164 { get; }

    /// <summary>SHA-256 of the phone digits with the country code, no <c>+</c> (<c>2348031234567</c>), or null.</summary>
    public string? HashedPhoneDigits { get; }

    /// <summary>Never shows the hashes (they are left out of logs, like values).</summary>
    public override string ToString() =>
        "HashedIdentifiers { HashedEmail = " + Shown(HashedEmail) + ", HashedPhoneE164 = " + Shown(HashedPhoneE164) + ", HashedPhoneDigits = " + Shown(HashedPhoneDigits) + " }";

    private static string Shown(string? v) => v is null ? "null" : "[set]";
}

/// <summary>
/// Hashed email and phone for ad network matching (SPEC 25). Pure and offline: no client needed.
/// </summary>
/// <remarks>
/// Normalise and hash a customer's email and / or phone on your own server, for a goal's
/// <see cref="GoalOptions.HashedEmail"/>, <see cref="GoalOptions.HashedPhoneE164"/> and
/// <see cref="GoalOptions.HashedPhoneDigits"/>. They are used only if the business turned on matching by hashed email
/// or phone for a destination. In private mode, hash on your own server: Clikgate never hashes for you there.
/// </remarks>
/// <example>
/// <code>
/// clikgate.Goal("account_opened", new GoalOptions { Reference = "APP-55231", ClickId = clickId }
///     .WithHashed(HashForAds.Hash(customer.Email, customer.Phone)));   // e.g. "+234 803 123 4567"
/// </code>
/// </example>
public static class HashForAds
{
    private static readonly Regex Sha256Hex = new("^[0-9a-f]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex E164Digits = new("^[1-9][0-9]{6,14}$", RegexOptions.CultureInvariant);
    private static readonly string[] Fields = ["hashed_email", "hashed_phone_e164", "hashed_phone_digits"];

    /// <summary>
    /// Hashes an email and / or a phone. A null input gives no value (its property is null).
    /// <list type="bullet">
    /// <item><description>email: trimmed and lowercased (culture-invariant); it must contain <c>@</c>.</description></item>
    /// <item><description>phone: must include its country code (start with <c>+</c> or <c>00</c>); spaces and punctuation
    /// are removed and the result must be 7-15 digits starting with 1-9. A national number such as <c>0803 123 4567</c>
    /// is refused: add the country code yourself, the SDK never guesses it.</description></item>
    /// </list>
    /// </summary>
    /// <param name="email">The customer's email, or null.</param>
    /// <param name="phone">The customer's phone with its country code (<c>+234 803 123 4567</c> or <c>00234…</c>), or null.</param>
    /// <exception cref="InvalidRequestException"><c>invalid_argument</c> with <c>Param</c> <c>email</c> or <c>phone</c>; the input is never in the message.</exception>
    public static HashedIdentifiers Hash(string? email, string? phone)
    {
        string? hashedEmail = null;
        string? hashedE164 = null;
        string? hashedDigits = null;
        if (email is not null)
        {
            var value = Trim(email).ToLowerInvariant();
            if (value.IndexOf('@') < 0)
            {
                throw Errors.Local("invalid_argument", "email must be an email address (it contains @).", "email");
            }
            hashedEmail = Sha256(value);
        }
        if (phone is not null)
        {
            var trimmed = Trim(phone);
            var sb = new StringBuilder(trimmed.Length);
            foreach (var c in trimmed)
            {
                if (c >= '0' && c <= '9')
                {
                    sb.Append(c);
                }
            }
            var digits = sb.ToString();
            if (trimmed.StartsWith("00", StringComparison.Ordinal))
            {
                digits = digits.Substring(2);
            }
            else if (!trimmed.StartsWith("+", StringComparison.Ordinal))
            {
                digits = string.Empty;
            }
            if (!E164Digits.IsMatch(digits))
            {
                throw Errors.Local("invalid_argument", "phone must include its country code, e.g. \"+234 803 123 4567\" (7-15 digits after the +).", "phone");
            }
            hashedE164 = Sha256("+" + digits);
            hashedDigits = Sha256(digits);
        }
        return new HashedIdentifiers(hashedEmail, hashedE164, hashedDigits);
    }

    /// <summary>Refuses a hashed wire field that isn't 64 lowercase hex characters (the value is never echoed).</summary>
    internal static void CheckWire(JsonObject wire)
    {
        foreach (var field in Fields)
        {
            if (!wire.TryGetPropertyValue(field, out var v) || v is null)
            {
                continue;
            }
            if (Json.Str(v) is not { } s || !Sha256Hex.IsMatch(s))
            {
                throw Errors.Local("invalid_hashed_identifier", field + " must be a SHA-256 hash as 64 lowercase hex characters (use HashForAds.Hash).", field);
            }
        }
    }

    /// <summary>Trims Unicode whitespace (and the BOM) at both ends.</summary>
    private static string Trim(string s)
    {
        var start = 0;
        var end = s.Length;
        while (start < end && IsSpace(s[start]))
        {
            start++;
        }
        while (end > start && IsSpace(s[end - 1]))
        {
            end--;
        }
        return s.Substring(start, end - start);
    }

    private static bool IsSpace(char c) => char.IsWhiteSpace(c) || c == '﻿';

    private static string Sha256(string value)
    {
        using var sha = SHA256.Create();
        var digest = sha.ComputeHash(Encoding.UTF8.GetBytes(value));
        var sb = new StringBuilder(digest.Length * 2);
        foreach (var b in digest)
        {
            sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }
}
