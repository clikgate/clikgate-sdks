using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Clikgate;

/// <summary>The visitor context for a goal (SPEC 13.1), from <see cref="ClickIds.Context(string?, Func{string, string?})"/>.</summary>
/// <remarks>The SDK parses the <c>User-Agent</c>; the User-Agent itself is never sent. All three fields are allowed in private mode.</remarks>
public sealed class ClickContext
{
    internal ClickContext(string? clickId, string? keptBy, string browserEngine, string platform)
    {
        ClickId = clickId;
        KeptBy = keptBy;
        BrowserEngine = browserEngine;
        Platform = platform;
    }

    /// <summary>The click ID (query, then cookie, then the <c>Clikgate-Click-Id</c> header), or null.</summary>
    public string? ClickId { get; }

    /// <summary>
    /// <c>server_cookie</c> (the cookie with the <c>_cg_kept=s</c> marker), <c>script_cookie</c> (without it), <c>form</c>
    /// (the <c>Clikgate-Click-Id</c> header), or null (e.g. straight from the URL, or no click ID).
    /// </summary>
    public string? KeptBy { get; }

    /// <summary><c>webkit_ios</c>, <c>safari_mac</c>, <c>chromium</c>, <c>gecko</c> or <c>other</c>.</summary>
    public string BrowserEngine { get; }

    /// <summary><c>ios</c>, <c>android</c>, <c>macos</c>, <c>windows</c>, <c>linux</c> or <c>other</c>.</summary>
    public string Platform { get; }
}

/// <summary>What the <c>/cg/keep</c> route sends: the status and the headers in order (the body is always empty).</summary>
public sealed class KeepResponse
{
    internal KeepResponse(int status, IReadOnlyList<KeyValuePair<string, string>> headers)
    {
        Status = status;
        Headers = headers;
    }

    /// <summary>204, 400, 403 or 405.</summary>
    public int Status { get; }

    /// <summary><c>Cache-Control</c>, then <c>Allow</c> (405) or the two <c>Set-Cookie</c> values (204), in order.</summary>
    public IReadOnlyList<KeyValuePair<string, string>> Headers { get; }
}

/// <summary>
/// The <c>/cg/keep</c> route (SPEC 13.1). The web script's <c>data-server-endpoint="/cg/keep"</c> posts the click
/// ID from the page URL here, and the response sets the first-party <c>_cg_&lt;param&gt;</c> cookie and the <c>_cg_kept=s</c>
/// marker from your own server. Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days
/// (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.
/// </summary>
/// <remarks>
/// Only <c>POST</c> from the same origin (<c>Sec-Fetch-Site: same-origin</c>, else an <c>Origin</c> equal to the host and
/// port); a JSON body of at most 1024 bytes with the same valid ID in <c>click_id</c> and <c>page_click_id</c>; the cookie
/// name from your configuration, never from the request; every response empty with <c>Cache-Control: no-store, private</c>,
/// never a redirect, nothing echoed or logged. <c>app.MapClikgateKeep("/cg/keep")</c> in <c>Clikgate.AspNetCore</c> calls
/// <see cref="Respond"/>. Thread-safe.
/// </remarks>
public sealed class ClikgateKeepRoute
{
    /// <summary>The largest body read: 1024 bytes. Adapters read at most <c>MaxBody + 1</c> bytes.</summary>
    public const int MaxBody = 1024;

    /// <summary>Sent on every response.</summary>
    public const string CacheControl = "no-store, private";

    private readonly ClickIds _clickIds;
    private readonly CookieOptions _options;

    internal ClikgateKeepRoute(ClickIds clickIds, CookieOptions options)
    {
        var days = options.Days;
        if (double.IsNaN(days) || days != Math.Floor(days) || days < 1 || days > 400)
        {
            throw Internal.Errors.Local("invalid_argument", "Days must be a whole number from 1 to 400 (browsers cap cookie lifetimes at 400 days).", "days");
        }
        _clickIds = clickIds;
        _options = new CookieOptions { Days = options.Days, Secure = options.Secure, Domain = options.Domain };
    }

    /// <summary>Answers one request.</summary>
    /// <param name="method">The HTTP method.</param>
    /// <param name="header">A case-insensitive header lookup (the first value, or null when absent).</param>
    /// <param name="body">The request body, at most <c>MaxBody + 1</c> bytes read (more is refused anyway).</param>
    public KeepResponse Respond(string method, Func<string, string?> header, byte[]? body)
    {
        if (!string.Equals(method, "POST", StringComparison.OrdinalIgnoreCase))
        {
            return Out(405, "Allow", "POST");
        }
        if (!SameOrigin(header("Sec-Fetch-Site"), header("Origin"), header("X-Forwarded-Host"), header("Host")))
        {
            return Out(403);
        }
        var id = ClickIdOf(body);
        return id is null
            ? Out(400)
            : Out(204, "Set-Cookie", _clickIds.CookieHeader(id, _options), "Set-Cookie", _clickIds.MarkerHeader(_options));
    }

    private static bool SameOrigin(string? fetchSite, string? origin, string? forwardedHost, string? host)
    {
        if (fetchSite is not null)
        {
            return string.Equals(fetchSite.Trim(), "same-origin", StringComparison.OrdinalIgnoreCase);
        }
        if (origin is null)
        {
            return false;
        }
        var h = !string.IsNullOrWhiteSpace(forwardedHost) ? forwardedHost!.Split(',')[0].Trim() : (host ?? string.Empty).Trim();
        if (h.Length == 0)
        {
            return false;
        }
        var o = origin.Trim();
        return string.Equals(o, "https://" + h, StringComparison.OrdinalIgnoreCase) || string.Equals(o, "http://" + h, StringComparison.OrdinalIgnoreCase);
    }

    private static string? ClickIdOf(byte[]? body)
    {
        if (body is null || body.Length == 0 || body.Length > MaxBody)
        {
            return null;
        }
        try
        {
            if (JsonNode.Parse(body) is not JsonObject o)
            {
                return null;
            }
            var id = Internal.Json.Str(o["click_id"]); // JsonObject reads its properties lazily: keep this inside the try
            var page = Internal.Json.Str(o["page_click_id"]);
            return ClickIds.IsValid(id) && string.Equals(id, page, StringComparison.Ordinal) ? id : null;
        }
        catch (JsonException)
        {
            return null;
        }
        catch (ArgumentException)
        {
            return null; // a duplicate property name
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static KeepResponse Out(int status, params string[] extra)
    {
        var headers = new List<KeyValuePair<string, string>> { new("Cache-Control", CacheControl) };
        for (var i = 0; i + 1 < extra.Length; i += 2)
        {
            headers.Add(new(extra[i], extra[i + 1]));
        }
        return new KeepResponse(status, headers);
    }
}
