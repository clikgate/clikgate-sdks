using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Clikgate.Internal;

/// <summary>Maps HTTP responses to typed exceptions (SPEC 5, rules 3-13).</summary>
internal static class Errors
{
    private const int Snippet = 200;
    private static readonly Regex Digits = new("^[0-9]+$", RegexOptions.CultureInvariant);
    private static readonly Regex Control = new("[\\x00-\\x1f\\x7f]", RegexOptions.CultureInvariant);

    public static InvalidRequestException Local(string code, string message, string? param = null) => new(message, code, param: param);

    public static ClikgateException FromResponse(int status, IReadOnlyDictionary<string, string> headers, byte[] body, long nowMs)
    {
        var text = Encoding.UTF8.GetString(body);
        JsonObject? env = null;
        string? refusalReason = null;
        try
        {
            var parsed = Json.Parse(body);
            if (parsed is JsonObject root && root["error"] is JsonObject e)
            {
                env = (JsonObject)e.DeepClone();
            }
            else if (parsed is JsonObject refusal && IsRefusalBody(refusal))
            {
                // A goal refusal answered as a result body (`422 {"status": "refused", "reason": "unknown_goal", ...}`):
                // the reason is the error code, and the body is kept as the raw object.
                refusalReason = Json.Str(refusal["reason"]);
                env = (JsonObject)refusal.DeepClone();
            }
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or FormatException or InvalidOperationException)
        {
            env = null;
        }
        string? S(string k) => env is not null && refusalReason is null ? Json.Str(env[k]) : null;
        var requestId = S("request_id") ?? (headers.TryGetValue("x-request-id", out var rid) ? rid : null);
        var redirect = status >= 300 && status < 400;
        var bodyCode = S("code") ?? refusalReason;
        var code = redirect ? "unexpected_status" : bodyCode ?? "http_" + status.ToString(CultureInfo.InvariantCulture);
        var message = S("message") ?? "HTTP " + status.ToString(CultureInfo.InvariantCulture) + (text.Length == 0 ? string.Empty : ": " + Control.Replace(text.Length > Snippet ? text.Substring(0, Snippet) : text, " "));
        var param = S("param");
        var type = S("type");
        if (status == 429)
        {
            return new RateLimitException(message, bodyCode ?? "rate_limit_exceeded", status, requestId, param, type, env, RetryAfterSeconds(headers, nowMs));
        }
        if (status >= 500)
        {
            return new ServerException(message, code, status, requestId, param, type, env, RetryAfterSeconds(headers, nowMs));
        }
        if (code == "private_mode_field_rejected")
        {
            return new PrivateModeFieldRejectedException(message, param ?? "unknown", status, requestId, type, env);
        }
        return status switch
        {
            401 => new AuthenticationException(message, code, status, requestId, param, type, env),
            403 => new PermissionException(message, code, status, requestId, param, type, env),
            404 => new NotFoundException(message, code, status, requestId, param, type, env),
            409 when type == "idempotency" || code.StartsWith("idempotency_", StringComparison.Ordinal) => new IdempotencyException(message, code, status, requestId, param, type, env),
            409 when code == "link_locked" => new LinkLockedException(message, code, status, requestId, param, type, env),
            409 => new ConflictException(message, code, status, requestId, param, type, env),
            >= 400 => new InvalidRequestException(message, code, status, requestId, param, type, env),
            _ => new ServerException(message, code, status, requestId, param, type, env, null),
        };
    }

    private static bool IsRefusalBody(JsonObject o) =>
        Json.Str(o["status"]) == "refused" && Json.Str(o["reason"]) is { Length: > 0 };

    public static ClikgateException FromBatchItem(int status, JsonNode? error)
    {
        var wrapper = new JsonObject { ["error"] = error is JsonObject o ? o.DeepClone() : new JsonObject() };
        return FromResponse(status, new Dictionary<string, string>(), Encoding.UTF8.GetBytes(wrapper.ToJsonString()), 0);
    }

    /// <summary><c>Retry-After</c> in milliseconds (delta-seconds or an HTTP-date against the SDK clock), or null.</summary>
    public static long? RetryAfterMs(IReadOnlyDictionary<string, string> headers, long nowMs)
    {
        if (!headers.TryGetValue("retry-after", out var v))
        {
            return null;
        }
        var s = v.Trim();
        if (Digits.IsMatch(s))
        {
            return long.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var secs) ? secs * 1000 : null;
        }
        if (DateTimeOffset.TryParseExact(s, "r", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var when))
        {
            return Math.Max(0, when.ToUnixTimeMilliseconds() - nowMs);
        }
        return null;
    }

    private static int? RetryAfterSeconds(IReadOnlyDictionary<string, string> headers, long nowMs)
    {
        var ms = RetryAfterMs(headers, nowMs);
        return ms is null ? null : (int)Math.Ceiling(ms.Value / 1000.0);
    }

    /// <summary>Wraps anything thrown inside a never-throwing path.</summary>
    public static ClikgateException Wrap(Exception e) => e switch
    {
        ClikgateException c => c,
        ArgumentException or FormatException or OverflowException => new InvalidRequestException(e.Message, "invalid_value", inner: e),
        _ => new ClikgateException(e.Message, "unexpected_error", inner: e),
    };

    /// <summary>The canonical (Node) class name of an SDK exception (SPEC section 2).</summary>
    public static string Canonical(Exception e)
    {
        var n = e.GetType().Name;
        return n switch
        {
            "ClikgateTimeoutException" => "TimeoutError",
            "ClikgateNetworkException" => "NetworkError",
            "ClikgateException" => "ClikgateError",
            _ when e is ClikgateException && n.EndsWith("Exception", StringComparison.Ordinal) => n.Substring(0, n.Length - "Exception".Length) + "Error",
            _ => n,
        };
    }
}
