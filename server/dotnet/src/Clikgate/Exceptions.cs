using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace Clikgate;

/// <summary>Base class of every exception the SDK throws (SPEC section 5).</summary>
/// <example>
/// <code>
/// try { await clikgate.Goals.SendAsync("account_opened", new GoalOptions { Reference = "APP-55231", Value = 2_000_000m }); }
/// catch (RateLimitException e) { Console.WriteLine($"retry in {e.RetryAfter} s"); }
/// catch (InvalidRequestException e) { Console.WriteLine($"{e.Code} {e.Param}"); }
/// </code>
/// </example>
public class ClikgateException : Exception
{
    /// <summary>Creates an exception.</summary>
    public ClikgateException(string message, string code, int? httpStatus = null, string? requestId = null, string? param = null, string? type = null, JsonObject? raw = null, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        HttpStatus = httpStatus;
        RequestId = requestId;
        Param = param;
        Type = type;
        Raw = raw;
    }

    /// <summary>Stable machine-readable code, e.g. <c>invalid_value</c>, <c>link_locked</c>, <c>network_error</c>.</summary>
    public string Code { get; }

    /// <summary>The HTTP status, or null for local, network and timeout errors.</summary>
    public int? HttpStatus { get; }

    /// <summary>The request ID (<c>req_…</c>) to quote to Clikgate support, when the API answered.</summary>
    public string? RequestId { get; }

    /// <summary>The request field the error is about, when there is one.</summary>
    public string? Param { get; }

    /// <summary>The envelope <c>type</c>, or null for local errors.</summary>
    public string? Type { get; }

    /// <summary>The raw <c>error</c> object from the API, including extra keys such as <c>required_plan</c>.</summary>
    public JsonObject? Raw { get; }

    internal string? RawString(string key) => Raw is not null && Raw.TryGetPropertyValue(key, out var v) && v is JsonValue jv && jv.TryGetValue(out string? s) ? s : null;
}

/// <summary>Invalid client options. Thrown by the constructor, never later.</summary>
public class ConfigurationException(string message, string code, string? param = null) : ClikgateException(message, code, param: param);

/// <summary>401: the API key is missing, invalid, expired or revoked.</summary>
public class AuthenticationException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw);

/// <summary>403: missing scope, role, feature or plan (<c>plan_limit_reached</c>, <c>test_link_limit_reached</c>, <c>cli_scope</c>, …).</summary>
public class PermissionException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw)
{
    /// <summary>On <c>plan_limit_reached</c> / <c>plan_upgrade_required</c>: the lowest plan that allows it.</summary>
    public string? RequiredPlan => RawString("required_plan");

    /// <summary>On <c>test_link_limit_reached</c>: the number of active test links allowed.</summary>
    public int? Limit => Raw is not null && Raw.TryGetPropertyValue("limit", out var v) && v is JsonValue jv && jv.TryGetValue(out int i) ? i : null;
}

/// <summary>400, 410, 422 and other 4xx; also local validation (<see cref="ClikgateException.HttpStatus"/> is null).</summary>
public class InvalidRequestException(string message, string code, int? httpStatus = null, string? requestId = null, string? param = null, string? type = null, JsonObject? raw = null, Exception? inner = null)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw, inner)
{
    /// <summary>For batch calls: the index of the event that failed local validation.</summary>
    public int? Index { get; internal set; }

    /// <summary>On <c>test_destination_not_allowed</c>: the allowed destination kinds.</summary>
    public IReadOnlyList<string>? Allowed
    {
        get
        {
            if (Raw is null || !Raw.TryGetPropertyValue("allowed", out var v) || v is not JsonArray a)
            {
                return null;
            }
            var list = new List<string>();
            foreach (var item in a)
            {
                list.Add(item?.ToString() ?? string.Empty);
            }
            return list;
        }
    }

    /// <summary>On <c>test_destination_not_allowed</c>: the docs page explaining test-link destinations.</summary>
    public string? DocUrl => RawString("doc_url");
}

/// <summary>Private mode refused a field (locally, before sending, or by the API). Carries the field <b>name</b> only.</summary>
public class PrivateModeFieldRejectedException(string message, string field, int? httpStatus = null, string? requestId = null, string? type = null, JsonObject? raw = null)
    : InvalidRequestException(message, "private_mode_field_rejected", httpStatus, requestId, field, type, raw)
{
    /// <summary>The refused field name, e.g. <c>metadata</c>. Never its value.</summary>
    public string Field { get; } = field;
}

/// <summary>404.</summary>
public class NotFoundException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw);

/// <summary>409.</summary>
public class ConflictException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw);

/// <summary>409 <c>link_locked</c>: destination, fallback and deep-link changes are refused. Never retried.</summary>
public class LinkLockedException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw)
    : ConflictException(message, code, httpStatus, requestId, param, type, raw);

/// <summary>409 <c>idempotency_*</c>: the key was used with a different request, or the first request is still running.</summary>
public class IdempotencyException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw);

/// <summary>429. <see cref="RetryAfter"/> is the number of seconds from <c>Retry-After</c>, or null.</summary>
public class RateLimitException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw, int? retryAfter)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw)
{
    /// <summary>Seconds from <c>Retry-After</c>, or null.</summary>
    public int? RetryAfter { get; } = retryAfter;
}

/// <summary>5xx, or an unexpected status (redirects are never followed).</summary>
public class ServerException(string message, string code, int? httpStatus, string? requestId, string? param, string? type, JsonObject? raw, int? retryAfter)
    : ClikgateException(message, code, httpStatus, requestId, param, type, raw)
{
    /// <summary>Seconds from <c>Retry-After</c> on a 503, or null.</summary>
    public int? RetryAfter { get; } = retryAfter;
}

/// <summary>The connection failed (DNS, refused, reset, TLS). Canonical name: <c>NetworkError</c>.</summary>
public class ClikgateNetworkException(string message, Exception? inner = null) : ClikgateException(message, "network_error", inner: inner);

/// <summary>The per-attempt timeout elapsed. Canonical name: <c>TimeoutError</c>.</summary>
public class ClikgateTimeoutException(string message) : ClikgateException(message, "timeout");

/// <summary>A webhook signature did not verify: <c>missing_signature</c>, <c>malformed_signature</c>, <c>timestamp_outside_tolerance</c>, <c>no_matching_signature</c> or <c>invalid_payload</c>.</summary>
public class SignatureVerificationException(string message, string code) : ClikgateException(message, code);
