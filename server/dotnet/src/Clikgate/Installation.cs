using System;
using System.Text.RegularExpressions;

namespace Clikgate;

/// <summary>
/// An app installation from the <c>Clikgate-Installation</c> header (SPEC section 24.1).
/// <para>
/// The mobile SDKs give the app a value <c>&lt;app_id&gt;:&lt;installation_id&gt;</c> to send to its own backend at
/// sign-in and on signed-in requests. It is not a secret. Pass it as <see cref="IdentifyUserParams.Installation"/>, so
/// your server never needs to know which Clikgate app ID belongs to which platform. The header only names the app
/// installation: the customer ID always comes from your own signed-in user, never from the request.
/// </para>
/// </summary>
/// <example><code>var installation = Installation.ParseHeader(Request.Headers["Clikgate-Installation"]); // or null</code></example>
public sealed class Installation : IEquatable<Installation>
{
    /// <summary>The header name the app sends to your backend.</summary>
    public const string Header = "Clikgate-Installation";

    /// <summary>Longer header values are refused before they are looked at.</summary>
    public const int MaxLength = 128;

    private static readonly char[] AsciiWhitespace = [' ', '\t', '\r', '\n', '\f', '\v'];

    /// <summary><c>app_</c> + a 26-character ID, one colon, a lowercase UUID.</summary>
    public static readonly Regex Pattern = new(
        @"\A(app_[0-9A-Z]{26}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\z",
        RegexOptions.CultureInvariant);

    private Installation(string appId, string installationId)
    {
        AppId = appId;
        InstallationId = installationId;
    }

    /// <summary>The Clikgate app ID (<c>app_…</c>).</summary>
    public string AppId { get; }

    /// <summary>The SDK's installation ID (a lowercase UUID).</summary>
    public string InstallationId { get; }

    /// <summary>
    /// Parses a <c>Clikgate-Installation</c> header value. Null for anything that isn't exactly
    /// <c>&lt;app_id&gt;:&lt;installation_id&gt;</c> (after trimming ASCII whitespace, at most 128 characters,
    /// lowercase UUID). Never throws.
    /// </summary>
    /// <example><code>var installation = Installation.ParseHeader(value);</code></example>
    public static Installation? ParseHeader(string? value)
    {
        if (value is null || value.Length > MaxLength)
        {
            return null;
        }
        var match = Pattern.Match(value.Trim(AsciiWhitespace));
        return match.Success ? new Installation(match.Groups[1].Value, match.Groups[2].Value) : null;
    }

    /// <inheritdoc/>
    public bool Equals(Installation? other) =>
        other is not null && AppId == other.AppId && InstallationId == other.InstallationId;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => Equals(obj as Installation);

    /// <inheritdoc/>
    public override int GetHashCode() => (AppId.GetHashCode() * 397) ^ InstallationId.GetHashCode();

    /// <inheritdoc/>
    public override string ToString() => $"Installation {{ AppId = {AppId}, InstallationId = {InstallationId} }}";
}
