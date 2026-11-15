using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace Clikgate;

/// <summary>
/// Your customer IDs in one canonical form, the form the API stores and checks: Unicode NFC,
/// trimmed of Unicode whitespace (and U+FEFF) at both ends, case kept. Warnings (first match wins): <c>empty</c>,
/// <c>too_long</c> (more than 128 characters), <c>looks_like_email</c>, <c>looks_like_national_id</c> (exactly 11
/// digits, unless <c>allow11DigitIds</c>), <c>looks_like_phone</c>. Use your own stable user ID (for example
/// <c>u_10482</c>), never an email, phone number, BVN or NIN.
/// </summary>
/// <example><code>CustomerIds.Warning("ada@example.com"); // "looks_like_email"</code></example>
public static class CustomerIds
{
    /// <summary>The longest customer ID kept as a known customer, in Unicode code points.</summary>
    public const int MaxLength = 128;

    // Unicode White_Space characters plus U+FEFF (the byte-order mark)
    private const string Trim =
        "\t\n\u000b\u000c\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

    private static readonly Regex NationalId = new("^[0-9]{11}$", RegexOptions.CultureInvariant);
    private static readonly Regex Phone = new("^\\+?[0-9]{10,15}$", RegexOptions.CultureInvariant);

    /// <summary>The canonical form of a customer ID: NFC, trimmed, case kept.</summary>
    public static string Canonical(string customerId) => customerId.Normalize(NormalizationForm.FormC).Trim(Trim.ToCharArray());

    /// <summary>Why Clikgate wouldn't keep this ID as a known customer, or null when it's fine.</summary>
    public static string? Warning(string customerId, bool allow11DigitIds = false)
    {
        var cid = Canonical(customerId);
        if (cid.Length == 0) return "empty";
        if (CodePoints(cid) > MaxLength) return "too_long";
        var at = cid.IndexOf('@');
        if (at >= 0 && cid.IndexOf('.', at + 1) >= 0) return "looks_like_email";
        if (NationalId.IsMatch(cid)) return allow11DigitIds ? null : "looks_like_national_id";
        if (Phone.IsMatch(cid.Replace(" ", string.Empty).Replace("-", string.Empty))) return "looks_like_phone";
        return null;
    }

    private static int CodePoints(string s) => s.Length - s.Count(char.IsLowSurrogate);
}
