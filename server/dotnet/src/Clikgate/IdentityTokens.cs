using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>
/// Identity tokens (SDK spec 8.5): your server proves to Clikgate that a customer ID belongs to the
/// person signed in to your app. The app passes the token to the mobile SDK's <c>identifyUser()</c>.
/// <c>token = base64url_nopad(HMAC_SHA256(secret, customerId + "." + issuedAt)) + "." + issuedAt</c>, the signer
/// Clikgate verifies with. No network call and no API key needed. Guide: https://clikgate.com/docs/identify-users
/// </summary>
/// <example><code>
/// var token = IdentityTokens.Create(user.Id);              // CLIKGATE_IDENTITY_SECRET
/// var token = IdentityTokens.Create(user.Id, "app_…");     // that app's secret from CLIKGATE_IDENTITY_SECRETS
/// </code></example>
public static class IdentityTokens
{
    /// <summary>The single secret's environment variable.</summary>
    public const string SecretEnv = "CLIKGATE_IDENTITY_SECRET";

    /// <summary>The per-app map's environment variable: a JSON object <c>{"app_…": "cgis_…"}</c>.</summary>
    public const string SecretsEnv = "CLIKGATE_IDENTITY_SECRETS";

    private const int MaxCustomerId = 255;

    // MAUI / Xamarin. Exact names: Microsoft.Maui.Graphics alone also runs on servers.
    private static readonly string[] ClientAssemblies =
    [
        "Microsoft.Maui", "Microsoft.Maui.Controls", "Xamarin.Forms.Core", "Xamarin.iOS", "Xamarin.Mac", "Mono.Android",
        "Microsoft.iOS", "Microsoft.Android", "Microsoft.MacCatalyst", "Microsoft.tvOS",
    ];

    private static readonly string[] ClientPlatforms = ["ANDROID", "IOS", "TVOS", "MACCATALYST", "WATCHOS", "BROWSER", "WASI"];

    private static readonly Lazy<bool> OnClientPlatform = new(() =>
        IsClientPlatform(p => RuntimeInformation.IsOSPlatform(OSPlatform.Create(p)), AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetName().Name ?? string.Empty)));

    /// <summary>
    /// A token for <paramref name="customerId"/> (your own user ID, 1-255 characters), issued now, signed with
    /// <paramref name="appId"/>'s secret from <c>CLIKGATE_IDENTITY_SECRETS</c>, else <c>CLIKGATE_IDENTITY_SECRET</c>.
    /// </summary>
    /// <exception cref="ClikgateServerOnlyException">In a MAUI, Xamarin or browser (WebAssembly) build.</exception>
    /// <exception cref="ConfigurationException">No secret is set (<c>missing_identity_secret</c>), or the map is malformed.</exception>
    /// <exception cref="InvalidRequestException">An empty or over-long customer ID (<c>invalid_customer_id</c>).</exception>
    public static string Create(string customerId, string? appId = null) =>
        CreateWith(OnClientPlatform.Value, null, null, Environment.GetEnvironmentVariable, customerId, appId, null, null);

    /// <summary>A token signed with an explicit secret and issue time (Unix seconds).</summary>
    public static string Create(string customerId, string secret, long issuedAtSeconds) =>
        CreateWith(OnClientPlatform.Value, null, null, Environment.GetEnvironmentVariable, customerId, null, secret, issuedAtSeconds);

    internal static bool ClientPlatform => OnClientPlatform.Value;

    internal static bool IsClientPlatform(Func<string, bool> isOsPlatform, IEnumerable<string> loadedAssemblies) =>
        ClientPlatforms.Any(isOsPlatform) || loadedAssemblies.Any(n => ClientAssemblies.Contains(n, StringComparer.Ordinal));

    internal static string CreateWith(
        bool clientPlatform,
        string? ownSecret,
        IReadOnlyDictionary<string, string>? ownSecrets,
        Func<string, string?> env,
        string? customerId,
        string? appId,
        string? secret,
        long? issuedAt)
    {
        if (clientPlatform)
        {
            throw new ClikgateServerOnlyException(
                "CreateIdentityToken() runs on your server only: it needs your identity secret, which must never be in an app or website. Return the token from your sign-in response instead. See https://clikgate.com/docs/identify-users");
        }
        if (string.IsNullOrEmpty(customerId) || CodePoints(customerId!) > MaxCustomerId)
        {
            // Never echo the customer ID.
            throw Errors.Local("invalid_customer_id", "customerId must be your own user ID as a string of 1-255 characters (never an email or phone number).", "customer_id");
        }
        var issued = issuedAt ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (issued < 0)
        {
            throw Errors.Local("invalid_argument", "issuedAt must be whole Unix seconds.", "issued_at");
        }
        return Sign(ResolveSecret(secret, appId, ownSecret, ownSecrets, env), customerId!, issued);
    }

    internal static string Sign(string secret, string customerId, long issuedAt)
    {
        var stamp = issuedAt.ToString(CultureInfo.InvariantCulture);
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var digest = hmac.ComputeHash(Encoding.UTF8.GetBytes(customerId + "." + stamp));
        return Convert.ToBase64String(digest).TrimEnd('=').Replace('+', '-').Replace('/', '_') + "." + stamp;
    }

    private static int CodePoints(string s)
    {
        var n = 0;
        for (var i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1]))
            {
                i++;
            }
            n++;
        }
        return n;
    }

    private static string ResolveSecret(string? secret, string? appId, string? ownSecret, IReadOnlyDictionary<string, string>? ownSecrets, Func<string, string?> env)
    {
        if (!string.IsNullOrEmpty(secret))
        {
            return secret!;
        }
        var secrets = ownSecrets ?? EnvMap(env(SecretsEnv));
        if (appId is not null && secrets is not null && secrets.TryGetValue(appId, out var forApp) && !string.IsNullOrEmpty(forApp))
        {
            return forApp;
        }
        var envSecret = env(SecretEnv);
        var single = !string.IsNullOrEmpty(ownSecret) ? ownSecret : (!string.IsNullOrEmpty(envSecret) ? envSecret : null);
        if (single is not null)
        {
            return single;
        }
        if (appId is null && secrets is not null && secrets.Count > 0)
        {
            throw new ConfigurationException("Several apps' identity secrets are set (" + SecretsEnv + "): pass the appId to choose one.", "missing_identity_secret", "appId");
        }
        var message = appId is null
            ? "No identity secret: set " + SecretEnv + " on your server (Apps > your app > Identity secret)."
            : "No identity secret for this app: add it to " + SecretsEnv + " or set " + SecretEnv + ".";
        throw new ConfigurationException(message, "missing_identity_secret", "secret");
    }

    internal static IReadOnlyDictionary<string, string>? EnvMap(string? raw)
    {
        if (raw is null || raw.Trim().Length == 0)
        {
            return null;
        }
        JsonNode? parsed;
        try
        {
            parsed = JsonNode.Parse(raw);
        }
        catch (JsonException)
        {
            parsed = null;
        }
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var ok = parsed is JsonObject;
        if (parsed is JsonObject obj)
        {
            foreach (var kv in obj)
            {
                if (kv.Value is not JsonValue v || !v.TryGetValue<string>(out var s) || s.Length == 0)
                {
                    ok = false;
                    break;
                }
                result[kv.Key] = s;
            }
        }
        if (!ok)
        {
            // Never echo the value: it holds secrets.
            throw new ConfigurationException(SecretsEnv + " must be a JSON object of app IDs to identity secrets, e.g. {\"app_…\": \"cgis_…\"}.", "invalid_identity_secrets", SecretsEnv);
        }
        return result;
    }
}
