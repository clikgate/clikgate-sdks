using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Clikgate;

/// <summary>
/// Webhook verification. No API key or client needed. <c>Clikgate-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;[,v1=…]</c>
/// with <c>hex = HMAC-SHA256(key = the whole secret including "whsec_", message = "&lt;t&gt;." + raw body)</c>.
/// </summary>
public static class Webhooks
{
    /// <summary>The default tolerance, in seconds.</summary>
    public const long DefaultTolerance = 300;
    private static readonly Regex Digits = new("^[0-9]+$", RegexOptions.CultureInvariant);

    /// <summary>Verifies a delivery over the raw body bytes and returns the parsed event. Throws <see cref="SignatureVerificationException"/>.</summary>
    /// <param name="rawBody">The exact bytes received.</param>
    /// <param name="signatureHeader">The <c>Clikgate-Signature</c> header.</param>
    /// <param name="secret">The endpoint secret (<c>whsec_…</c>).</param>
    /// <param name="tolerance">Maximum age (and future skew) in seconds; 0 disables the check (tests only).</param>
    /// <param name="now">The current Unix time in seconds (default: now).</param>
    /// <example>
    /// <code>
    /// app.MapPost("/webhooks/clikgate", async (HttpRequest req) => {
    ///     using var ms = new MemoryStream(); await req.Body.CopyToAsync(ms);
    ///     var ev = Webhooks.Verify(ms.ToArray(), req.Headers["Clikgate-Signature"], secret);
    ///     return Results.Ok();   // dedupe on ev.Id: delivery is at-least-once
    /// });
    /// </code>
    /// </example>
    public static WebhookEvent Verify(byte[] rawBody, string? signatureHeader, string secret, long tolerance = DefaultTolerance, long? now = null)
    {
        if (string.IsNullOrEmpty(secret))
        {
            throw Internal.Errors.Local("invalid_argument", "secret must be the endpoint secret (whsec_…).", "secret");
        }
        return Check(rawBody, signatureHeader, [secret], tolerance, now);
    }

    /// <summary><see cref="Verify(byte[], string?, string, long, long?)"/> over a string body (encoded as UTF-8).</summary>
    public static WebhookEvent Verify(string rawBody, string? signatureHeader, string secret, long tolerance = DefaultTolerance, long? now = null) =>
        Verify(Encoding.UTF8.GetBytes(rawBody ?? string.Empty), signatureHeader, secret, tolerance, now);

    /// <summary>Like Verify, accepting any of several secrets (while you rotate your own).</summary>
    /// <example><code>var ev = Webhooks.VerifyAny(body, header, [newSecret, oldSecret]);</code></example>
    public static WebhookEvent VerifyAny(byte[] rawBody, string? signatureHeader, IReadOnlyList<string> secrets, long tolerance = DefaultTolerance, long? now = null)
    {
        if (secrets is null || secrets.Count == 0 || secrets.Contains(string.Empty))
        {
            throw Internal.Errors.Local("invalid_argument", "secrets must be a non-empty list of endpoint secrets.", "secrets");
        }
        return Check(rawBody, signatureHeader, secrets, tolerance, now);
    }

    private static WebhookEvent Check(byte[] body, string? header, IReadOnlyList<string> secrets, long tolerance, long? now)
    {
        if (string.IsNullOrWhiteSpace(header))
        {
            throw Fail("missing_signature", "The Clikgate-Signature header is missing.");
        }
        long? t = null;
        var bad = false;
        var v1 = new List<string>();
        foreach (var part in header!.Split(','))
        {
            var p = part.Trim();
            var eq = p.IndexOf('=');
            if (eq < 0)
            {
                continue;
            }
            var key = p.Substring(0, eq).Trim();
            var value = p.Substring(eq + 1).Trim();
            if (key == "t")
            {
                if (Digits.IsMatch(value) && long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var ts))
                {
                    t = ts;
                }
                else
                {
                    bad = true;
                }
            }
            else if (key == "v1")
            {
                v1.Add(value);
            }
        }
        if (bad || t is null || v1.Count == 0)
        {
            throw Fail("malformed_signature", "The Clikgate-Signature header is malformed (expected t=<unix seconds>,v1=<hex>).");
        }
        var current = now ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (tolerance > 0 && Math.Abs(current - t.Value) > tolerance)
        {
            throw Fail("timestamp_outside_tolerance", "The signature timestamp is more than " + tolerance.ToString(CultureInfo.InvariantCulture) + " s from now; the request may be a replay, or this server's clock is wrong.");
        }
        var prefix = Encoding.UTF8.GetBytes(t.Value.ToString(CultureInfo.InvariantCulture) + ".");
        var message = new byte[prefix.Length + body.Length];
        Buffer.BlockCopy(prefix, 0, message, 0, prefix.Length);
        Buffer.BlockCopy(body, 0, message, prefix.Length, body.Length);
        var matched = false;
        foreach (var secret in secrets)
        {
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var expected = Encoding.ASCII.GetBytes(Hex(hmac.ComputeHash(message)));
            foreach (var candidate in v1)
            {
                var c = Encoding.UTF8.GetBytes(candidate);
                if (c.Length == expected.Length && FixedTimeEquals(expected, c))
                {
                    matched = true;
                }
            }
        }
        if (!matched)
        {
            throw Fail("no_matching_signature", "No signature matches: check the endpoint secret, and that you pass the raw body.");
        }
        JsonNode? ev;
        try
        {
            ev = JsonNode.Parse(Encoding.UTF8.GetString(body));
        }
        catch (JsonException)
        {
            throw Fail("invalid_payload", "The body is not JSON.");
        }
        return ev is JsonObject o ? new WebhookEvent(o) : throw Fail("invalid_payload", "The body is not an event object.");
    }

    private static bool FixedTimeEquals(byte[] a, byte[] b)
    {
        var diff = 0;
        for (var i = 0; i < a.Length; i++)
        {
            diff |= a[i] ^ b[i];
        }
        return diff == 0;
    }

    private static string Hex(byte[] d)
    {
        var sb = new StringBuilder(d.Length * 2);
        foreach (var b in d)
        {
            sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
        }
        return sb.ToString();
    }

    private static SignatureVerificationException Fail(string code, string message) => new(message, code);
}
