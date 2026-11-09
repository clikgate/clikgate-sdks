using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Clikgate;

/// <summary>Options of the click-ID cookie.</summary>
public sealed class CookieOptions
{
    /// <summary>Lifetime in days (default 30).</summary>
    public double Days { get; set; } = 30;

    /// <summary>Add <c>Secure</c> (default true; ASP.NET Core uses the request's scheme).</summary>
    public bool Secure { get; set; } = true;

    /// <summary>Cookie domain, e.g. <c>.example.com</c>.</summary>
    public string? Domain { get; set; }
}

/// <summary>
/// Click IDs (SPEC section 13): read them from requests, keep them in the web script's first-party cookie, and find
/// them in payment providers' payloads. Framework-neutral; <c>Clikgate.AspNetCore</c> adds <c>HttpContext</c> helpers.
/// </summary>
public sealed class ClickIds
{
    /// <summary>The header a caller (your mobile app or BFF) can use to pass the click ID.</summary>
    public const string Header = "Clikgate-Click-Id";

    /// <summary>The marker cookie: <c>_cg_kept=s</c> says your server kept the click ID (<c>kept_by: server_cookie</c>).</summary>
    public const string Marker = "_cg_kept";
    private static readonly Regex Pattern = new("^clk_[0-9A-Z]{26}$", RegexOptions.CultureInvariant);
    private static readonly string[] PaymentKeys = ["cg_click_id", "cgid", "clikgate_click_id"];
    private static readonly string[] Containers = ["metadata", "meta", "meta_data", "note_attributes", "attributes", "custom_attributes", "customAttributes"];
    private readonly Func<string> _param;

    /// <summary>Helpers with the default parameter, <c>cgid</c>. Prefer <c>clikgate.ClickIds</c>, which knows your organisation's.</summary>
    public ClickIds()
        : this(() => "cgid")
    {
    }

    internal ClickIds(Func<string> param) => _param = param;

    /// <summary>The query parameter in use.</summary>
    public string ParamName => _param();

    /// <summary><c>_cg_&lt;param&gt;</c>: the same first-party cookie the web script writes.</summary>
    public string CookieName => "_cg_" + _param();

    /// <summary>True when <paramref name="id"/> is a Clikgate click ID (<c>clk_</c> + 26 characters).</summary>
    /// <example><code>ClickIds.IsValid("clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"); // true</code></example>
    public static bool IsValid(object? id) => id is string s && Pattern.IsMatch(s);

    /// <summary>
    /// Reads the click ID: the query parameter, then the <c>_cg_&lt;param&gt;</c> cookie, then the <c>Clikgate-Click-Id</c> header.
    /// Only valid IDs are returned.
    /// </summary>
    /// <param name="url">The URL or path with its query string.</param>
    /// <param name="header">A case-insensitive header lookup (null when absent).</param>
    /// <example><code>var clickId = clikgate.ClickIds.FromRequest(url, name => headers[name]);</code></example>
    public string? FromRequest(string? url, Func<string, string?> header) => Locate(url, header).ClickId;

    private (string? ClickId, string? Source) Locate(string? url, Func<string, string?> header)
    {
        foreach (var v in QueryValues(url, ParamName))
        {
            if (IsValid(v))
            {
                return (v, "query");
            }
        }
        foreach (var v in CookieValues(header("Cookie"), CookieName))
        {
            if (IsValid(v))
            {
                return (v, "cookie");
            }
        }
        var h = header(Header)?.Trim();
        return IsValid(h) ? (h, "header") : (null, null);
    }

    /// <summary>
    /// The visitor context for a goal (SPEC 13.1): the click ID, how it was kept and the browser engine and platform,
    /// parsed from the <c>User-Agent</c> here in the SDK (the User-Agent itself is never sent).
    /// </summary>
    /// <param name="url">The URL or path with its query string.</param>
    /// <param name="header">A case-insensitive header lookup (null when absent).</param>
    /// <example><code>var ctx = clikgate.ClickIds.Context(url, name => headers[name]);</code></example>
    public ClickContext Context(string? url, Func<string, string?> header)
    {
        var (clickId, source) = Locate(url, header);
        string? keptBy = source switch
        {
            "cookie" => CookieValues(header("Cookie"), Marker).Contains("s") ? "server_cookie" : "script_cookie",
            "header" => "form",
            _ => null,
        };
        var ua = header("User-Agent");
        return new ClickContext(clickId, keptBy, ParseBrowserEngine(ua), ParsePlatform(ua));
    }

    /// <summary><see cref="Context(string?, Func{string, string?})"/> with a header dictionary (names in any case).</summary>
    public ClickContext Context(string? url, IEnumerable<KeyValuePair<string, string>> headers) => Context(url, Lookup(headers));

    /// <summary>The browser engine from a <c>User-Agent</c> (SPEC 13.1): <c>webkit_ios</c>, <c>gecko</c>, <c>chromium</c>, <c>safari_mac</c> or <c>other</c>.</summary>
    public static string ParseBrowserEngine(string? userAgent)
    {
        var ua = userAgent ?? string.Empty;
        if (Has(ua, "iPhone", "iPad", "iPod"))
        {
            return "webkit_ios";
        }
        if (Has(ua, "Firefox/"))
        {
            return "gecko";
        }
        if (Has(ua, "Chrome/", "Chromium/", "Edg/", "OPR/", "SamsungBrowser/"))
        {
            return "chromium";
        }
        return Has(ua, "Macintosh") && Has(ua, "Safari/") && Has(ua, "Version/") ? "safari_mac" : "other";
    }

    /// <summary>The platform from a <c>User-Agent</c> (SPEC 13.1): <c>ios</c>, <c>android</c>, <c>macos</c>, <c>windows</c>, <c>linux</c> or <c>other</c>.</summary>
    public static string ParsePlatform(string? userAgent)
    {
        var ua = userAgent ?? string.Empty;
        return Has(ua, "iPhone", "iPad", "iPod") ? "ios"
            : Has(ua, "Android") ? "android"
            : Has(ua, "Macintosh", "Mac OS X") ? "macos"
            : Has(ua, "Windows") ? "windows"
            : Has(ua, "Linux", "X11") ? "linux"
            : "other";
    }

    private static bool Has(string haystack, params string[] needles) => needles.Any(n => haystack.IndexOf(n, StringComparison.Ordinal) >= 0);

    /// <summary>
    /// The <c>/cg/keep</c> route (SPEC 13.1) for the web script's <c>data-server-endpoint="/cg/keep"</c>: the
    /// framework-neutral core that <c>app.MapClikgateKeep("/cg/keep")</c> calls. <c>Secure</c> defaults to true;
    /// <c>Days</c> must be a whole number from 1 to 400.
    /// </summary>
    /// <exception cref="InvalidRequestException"><c>invalid_argument</c> for days outside 1-400.</exception>
    public ClikgateKeepRoute KeepRoute(CookieOptions? options = null) => new(this, options ?? new CookieOptions());

    private static Func<string, string?> Lookup(IEnumerable<KeyValuePair<string, string>> headers)
    {
        var list = headers.ToList();
        return name =>
        {
            var values = list.Where(kv => string.Equals(kv.Key, name, StringComparison.OrdinalIgnoreCase)).Select(kv => kv.Value).ToList();
            return values.Count == 0 ? null : string.Join(string.Equals(name, "cookie", StringComparison.OrdinalIgnoreCase) ? "; " : ", ", values);
        };
    }

    /// <summary><see cref="FromRequest(string?, Func{string, string?})"/> with a header dictionary (names in any case).</summary>
    public string? FromRequest(string? url, IEnumerable<KeyValuePair<string, string>> headers) => FromRequest(url, Lookup(headers));

    /// <summary>The first valid click ID in the query string only (the add-ons persist only those).</summary>
    public string? FromQuery(string? url) => QueryValues(url, ParamName).FirstOrDefault(v => IsValid(v));

    /// <summary>
    /// The <c>Set-Cookie</c> value that keeps the click ID: <c>SameSite=Lax</c>, <c>Secure</c> on HTTPS, not <c>HttpOnly</c>
    /// (the web script reads it).
    /// </summary>
    /// <example><code>clikgate.ClickIds.CookieHeader(clickId); // "_cg_cgid=clk_…; Path=/; Max-Age=2592000; SameSite=Lax; Secure"</code></example>
    public string CookieHeader(string clickId, CookieOptions? options = null)
    {
        if (!IsValid(clickId))
        {
            throw Internal.Errors.Local("invalid_click_id", "That is not a Clikgate click ID (clk_ + 26 characters).", "click_id");
        }
        var o = options ?? new CookieOptions();
        var sb = new StringBuilder();
        sb.Append(CookieName).Append('=').Append(clickId).Append("; Path=/; Max-Age=").Append(Math.Round(o.Days * 86400).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrEmpty(o.Domain))
        {
            sb.Append("; Domain=").Append(o.Domain);
        }
        sb.Append("; SameSite=Lax");
        if (o.Secure)
        {
            sb.Append("; Secure");
        }
        return sb.ToString();
    }

    /// <summary>
    /// The <c>Set-Cookie</c> value of the <c>_cg_kept=s</c> marker, with the same <c>Path</c>, <c>Max-Age</c>,
    /// <c>Domain</c>, <c>SameSite</c> and <c>Secure</c> as the click-ID cookie.
    /// </summary>
    public string MarkerHeader(CookieOptions? options = null)
    {
        var o = options ?? new CookieOptions();
        var sb = new StringBuilder();
        sb.Append(Marker).Append("=s; Path=/; Max-Age=").Append(Math.Round(o.Days * 86400).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrEmpty(o.Domain))
        {
            sb.Append("; Domain=").Append(o.Domain);
        }
        sb.Append("; SameSite=Lax");
        if (o.Secure)
        {
            sb.Append("; Secure");
        }
        return sb.ToString();
    }

    /// <summary>
    /// Adds the click-ID cookie through a header adder that appends (keeping existing <c>Set-Cookie</c> headers), then the
    /// <c>_cg_kept=s</c> marker with the same attributes (so the web script reports <c>kept_by: server_cookie</c>).
    /// </summary>
    /// <example><code>clikgate.ClickIds.Persist((name, value) => response.Headers.Append(name, value), clickId);</code></example>
    public void Persist(Action<string, string> appendHeader, string clickId, CookieOptions? options = null)
    {
        appendHeader("Set-Cookie", CookieHeader(clickId, options));
        appendHeader("Set-Cookie", MarkerHeader(options));
    }

    /// <summary>
    /// Finds the click ID in a payment provider's payload (JSON text, a <see cref="JsonNode"/> or a <see cref="JsonElement"/>):
    /// Paystack <c>metadata</c> (and <c>custom_fields</c>), Flutterwave <c>meta</c>, Shopify note or cart attributes, WooCommerce order meta.
    /// </summary>
    /// <example><code>var clickId = clikgate.ClickIds.FromPaymentMetadata(await new StreamReader(Request.Body).ReadToEndAsync());</code></example>
    public string? FromPaymentMetadata(object? payload)
    {
        var p = payload switch
        {
            string s => TryParse(s),
            JsonValue v when v.TryGetValue(out string? text) => TryParse(text),
            JsonNode n => n,
            JsonElement e => TryParse(e.GetRawText()),
            _ => null,
        };
        if (p is not JsonObject root)
        {
            return null;
        }
        var candidates = new List<JsonObject> { root };
        if (root["data"] is JsonObject data)
        {
            candidates.Add(data);
        }
        foreach (var c in candidates)
        {
            var own = Pick(c, 0);
            if (own is not null)
            {
                return own;
            }
            foreach (var name in Containers)
            {
                if (c[name] is null)
                {
                    continue;
                }
                var found = Pick(AsMap(c[name]), 0);
                if (found is not null)
                {
                    return found;
                }
            }
        }
        return null;
    }

    private static JsonNode? TryParse(string s)
    {
        try
        {
            return JsonNode.Parse(s);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static JsonObject? AsMap(JsonNode? container)
    {
        var c = container is JsonValue v && v.TryGetValue(out string? s) ? TryParse(s) : container;
        if (c is JsonArray a)
        {
            var m = new JsonObject();
            foreach (var item in a.OfType<JsonObject>())
            {
                var k = Internal.Json.Str(item["name"]) ?? Internal.Json.Str(item["key"]) ?? Internal.Json.Str(item["variable_name"]) ?? Internal.Json.Str(item["display_name"]);
                if (k is not null)
                {
                    m[k] = item["value"]?.DeepClone();
                }
            }
            return m;
        }
        return c as JsonObject;
    }

    private static string? Pick(JsonObject? m, int depth)
    {
        if (m is null)
        {
            return null;
        }
        foreach (var k in PaymentKeys)
        {
            var v = Internal.Json.Str(m[k]);
            if (IsValid(v))
            {
                return v;
            }
        }
        return depth == 0 && m["custom_fields"] is JsonArray ? Pick(AsMap(m["custom_fields"]), 1) : null;
    }

    private static IEnumerable<string> QueryValues(string? url, string name)
    {
        if (url is null)
        {
            yield break;
        }
        var q = url.IndexOf('?');
        if (q < 0)
        {
            yield break;
        }
        var query = url.Substring(q + 1);
        var hash = query.IndexOf('#');
        if (hash >= 0)
        {
            query = query.Substring(0, hash);
        }
        foreach (var pair in query.Split('&'))
        {
            if (pair.Length == 0)
            {
                continue;
            }
            var eq = pair.IndexOf('=');
            var k = Decode(eq < 0 ? pair : pair.Substring(0, eq), true);
            if (k == name)
            {
                yield return Decode(eq < 0 ? string.Empty : pair.Substring(eq + 1), true);
            }
        }
    }

    private static IEnumerable<string> CookieValues(string? header, string name)
    {
        if (header is null)
        {
            yield break;
        }
        foreach (var part in header.Split(';'))
        {
            var eq = part.IndexOf('=');
            if (eq < 0 || part.Substring(0, eq).Trim() != name)
            {
                continue;
            }
            var v = part.Substring(eq + 1).Trim();
            if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"')
            {
                v = v.Substring(1, v.Length - 2);
            }
            yield return Decode(v, false);
        }
    }

    private static string Decode(string s, bool plusIsSpace)
    {
        try
        {
            return Uri.UnescapeDataString(plusIsSpace ? s.Replace('+', ' ') : s);
        }
        catch (UriFormatException)
        {
            return s;
        }
    }
}
