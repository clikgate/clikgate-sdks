using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>The options of one goal event. Only <see cref="Reference"/> is required.</summary>
/// <example>
/// <code>
/// new GoalOptions { ClickId = application.ClickId, Reference = "APP-55231", Value = 2_000_000m, Currency = "NGN" }
/// </code>
/// </example>
public class GoalOptions
{
    /// <summary>Your own unique ID for this event (application number, order ID, transaction reference), 1-128 characters.</summary>
    public string? Reference { get; set; }

    /// <summary>The Clikgate click ID you kept (<c>clk_…</c>).</summary>
    public string? ClickId { get; set; }

    /// <summary>An offline or creator code, instead of a click ID.</summary>
    public string? Code { get; set; }

    /// <summary>The value in normal units (₦2,000,000 is <c>2_000_000m</c>), sent as a decimal string.</summary>
    public MoneyValue? Value { get; set; }

    /// <summary>ISO 4217; defaults to the goal's default currency.</summary>
    public string? Currency { get; set; }

    /// <summary>
    /// The payment provider of a Payment goal, e.g. <c>Provider.PAYSTACK</c>, or a provider key such as <c>"paystack"</c>
    /// (also a gateway added after this SDK release; the API validates it). Any goal may carry it.
    /// </summary>
    public Provider? Provider { get; set; }

    /// <summary>Your statement that this is the customer's first such event.</summary>
    public bool? IsFirst { get; set; }

    /// <summary>
    /// The person's label your team sees instead of the click ID (1-80 characters, <c>""</c> clears it; Growth and up).
    /// In private mode only when the organisation allows labels there.
    /// </summary>
    public string? Label { get; set; }

    /// <summary>
    /// How the click ID was kept: <c>server_cookie</c>, <c>script_cookie</c>, <c>form</c>,
    /// <c>payment_metadata</c> or <c>unknown</c>. Allowed in private mode. See <see cref="ClickIds.Context(string?, Func{string, string?})"/>.
    /// </summary>
    public string? KeptBy { get; set; }

    /// <summary>The browser engine: <c>webkit_ios</c>, <c>safari_mac</c>, <c>chromium</c>, <c>gecko</c> or <c>other</c>.</summary>
    public string? BrowserEngine { get; set; }

    /// <summary>The platform: <c>ios</c>, <c>android</c>, <c>macos</c>, <c>windows</c>, <c>linux</c> or <c>other</c>.</summary>
    public string? Platform { get; set; }

    /// <summary>
    /// SHA-256 of the customer's email, trimmed and lowercased, as 64 lowercase hex characters, for ad network matching;
    /// make it with <see cref="HashForAds.Hash(string?, string?)"/>. Used only if the business turned on matching by
    /// hashed email or phone for a destination. In private mode, hash on your own server: Clikgate never hashes for you
    /// there. Any other value is refused locally (<c>invalid_hashed_identifier</c>).
    /// </summary>
    public string? HashedEmail { get; set; }

    /// <summary>SHA-256 of the phone in E.164 with the <c>+</c> (<see cref="HashForAds.Hash(string?, string?)"/>). See <see cref="HashedEmail"/>.</summary>
    public string? HashedPhoneE164 { get; set; }

    /// <summary>SHA-256 of the phone digits with the country code, no <c>+</c> (<see cref="HashForAds.Hash(string?, string?)"/>). See <see cref="HashedEmail"/>.</summary>
    public string? HashedPhoneDigits { get; set; }

    /// <summary>
    /// Sets <see cref="HashedEmail"/>, <see cref="HashedPhoneE164"/> and <see cref="HashedPhoneDigits"/> from
    /// <see cref="HashForAds.Hash(string?, string?)"/> (the ones it made; the others become null).
    /// </summary>
    /// <example><code>clikgate.Goal("account_opened", new GoalOptions { Reference = "APP-55231", ClickId = clickId }.WithHashed(HashForAds.Hash(customer.Email, customer.Phone)));</code></example>
    public GoalOptions WithHashed(HashedIdentifiers? hashed)
    {
        if (hashed is null)
        {
            return this;
        }
        HashedEmail = hashed.HashedEmail;
        HashedPhoneE164 = hashed.HashedPhoneE164;
        HashedPhoneDigits = hashed.HashedPhoneDigits;
        return this;
    }

    /// <summary>
    /// Sets <see cref="KeptBy"/>, <see cref="BrowserEngine"/>, <see cref="Platform"/> and, when neither
    /// <see cref="ClickId"/> nor <see cref="Code"/> is set, <see cref="ClickId"/> from a visitor context.
    /// </summary>
    /// <example><code>clikgate.Goal("account_opened", new GoalOptions { Reference = "APP-55231" }.WithContext(ctx));</code></example>
    public GoalOptions WithContext(ClickContext? context)
    {
        if (context is null)
        {
            return this;
        }
        if (ClickId is null && Code is null)
        {
            ClickId = context.ClickId;
        }
        KeptBy = context.KeptBy;
        BrowserEngine = context.BrowserEngine;
        Platform = context.Platform;
        return this;
    }

    /// <summary>When it happened (defaults to now on the server).</summary>
    public DateTimeOffset? OccurredAt { get; set; }

    /// <summary>When it happened, as an RFC 3339 string (sent unchanged).</summary>
    public string? OccurredAtString { get; set; }

    /// <summary>Up to 8 KB of your own data. Refused in private mode.</summary>
    public IDictionary<string, object?>? Metadata { get; set; }

    /// <summary>Consent signals (<c>analytics</c>, <c>attribution</c>, <c>ad_user_data</c>, <c>ad_personalization</c>). Allowed in private mode.</summary>
    public IDictionary<string, object?>? Consent { get; set; }

    /// <summary>Additional wire fields, sent as is (forward compatibility). Checked by the private-mode guard.</summary>
    public IDictionary<string, object?>? Extra { get; set; }
}

/// <summary>One event of <see cref="Goals.SendBatchAsync"/>: the goal key plus its options.</summary>
public sealed class GoalBatchEvent : GoalOptions
{
    /// <summary>The goal key, e.g. <c>order_paid</c>.</summary>
    public string? Goal { get; set; }
}

/// <summary>
/// Goal events: the outcomes your business cares about (<c>account_opened</c>, <c>loan_disbursed</c>, <c>order_paid</c>).
/// <c>Goals.SendAsync</c> waits for the API and throws on failure; <c>ClikgateClient.Goal()</c> never throws.
/// </summary>
public sealed class Goals
{
    private static readonly Regex GoalKey = new("^[a-z][a-z0-9_]{1,39}$", RegexOptions.CultureInvariant);
    private static readonly Regex ProviderKey = new("^[a-z][a-z0-9_]{1,29}$", RegexOptions.CultureInvariant);
    private readonly Core _core;

    internal Goals(Core core) => _core = core;

    internal static string CheckKey(string? key) => key is not null && GoalKey.IsMatch(key)
        ? key
        : throw Errors.Local("invalid_goal_key", "Goal keys are snake_case, 2-40 characters, starting with a letter (e.g. \"account_opened\").", "goal");

    internal static string CheckReference(string? reference)
    {
        if (reference is null || reference.Length == 0 || reference.Count(c => !char.IsLowSurrogate(c)) > 128)
        {
            throw Errors.Local("invalid_reference", "reference is required: your own unique ID for this event, 1-128 characters.", "reference");
        }
        return reference;
    }

    /// <summary>The visitor context values (SPEC 9.1, 13.1).</summary>
    internal static readonly string[] KeptByValues = ["server_cookie", "script_cookie", "form", "payment_metadata", "unknown"];
    internal static readonly string[] BrowserEngineValues = ["webkit_ios", "safari_mac", "chromium", "gecko", "other"];
    internal static readonly string[] PlatformValues = ["ios", "android", "macos", "windows", "linux", "other"];

    internal static string? CheckEnum(string? value, string[] allowed, string field) => value is null || Array.IndexOf(allowed, value) >= 0
        ? value
        : throw Errors.Local("invalid_argument", field + " must be one of " + string.Join(", ", allowed) + ".", field);

    internal static string? CheckProvider(Provider? provider)
    {
        if (provider is { } p && (p.Value is null || !ProviderKey.IsMatch(p.Value)))
        {
            throw Errors.Local("invalid_provider", "provider must be a provider key such as \"paystack\" or \"stripe\" (lower case).", "provider");
        }
        return provider?.Value;
    }

    /// <summary>Validates goal options and builds the wire object (SPEC 9.1 step 1).</summary>
    internal static JsonObject Wire(string? key, GoalOptions? options)
    {
        var goal = CheckKey(key);
        var o = options ?? new GoalOptions();
        var reference = CheckReference(o.Reference);
        if (o.ClickId is not null && o.Code is not null)
        {
            throw Errors.Local("click_id_and_code", "Send either ClickId or Code, not both.", "code");
        }
        var provider = CheckProvider(o.Provider);
        var keptBy = CheckEnum(o.KeptBy, KeptByValues, "kept_by");
        var browserEngine = CheckEnum(o.BrowserEngine, BrowserEngineValues, "browser_engine");
        var platform = CheckEnum(o.Platform, PlatformValues, "platform");
        var wire = new JsonObject { ["goal"] = goal, ["reference"] = reference };
        void Put(string k, object? v)
        {
            if (v is not null)
            {
                wire[k] = Json.ToNode(v);
            }
        }
        Put("click_id", o.ClickId);
        Put("code", o.Code);
        Put("value", o.Value?.Wire);
        Put("currency", o.Currency);
        Put("provider", provider);
        Put("is_first", o.IsFirst);
        Put("label", o.Label);
        Put("kept_by", keptBy);
        Put("browser_engine", browserEngine);
        Put("platform", platform);
        Put("hashed_email", o.HashedEmail);
        Put("hashed_phone_e164", o.HashedPhoneE164);
        Put("hashed_phone_digits", o.HashedPhoneDigits);
        Put("occurred_at", o.OccurredAtString ?? (o.OccurredAt is { } at ? Dates.Format(at) : null));
        Put("metadata", o.Metadata);
        Put("consent", o.Consent);
        if (o.Extra is not null)
        {
            foreach (var kv in o.Extra)
            {
                Put(kv.Key, kv.Value);
            }
        }
        HashForAds.CheckWire(wire);
        return wire;
    }

    /// <summary>Config-based warnings (SPEC 12.3, warn-only) and the guard (12.2).</summary>
    internal static void CheckBeforeSend(Core core, (bool Guard, ServerSdkConfig? Config) state, JsonObject wire)
    {
        if (state.Config is not null && core.PrivateMode == PrivateMode.Auto)
        {
            var key = Json.Str(wire["goal"]) ?? string.Empty;
            var g = state.Config.Goals.FirstOrDefault(x => Json.Str(x["key"]) == key);
            if (g is null)
            {
                core.Warn("unknown_goal", "The goal \"" + key + "\" isn't defined for your organisation (it will be sent; the API decides).", key);
            }
            else
            {
                var mode = Json.Str(g["value_mode"]);
                if (mode == "none" && wire.ContainsKey("value"))
                {
                    core.Warn("value_not_allowed", "The goal \"" + key + "\" takes no value.", key);
                }
                if (mode == "required" && !wire.ContainsKey("value"))
                {
                    core.Warn("value_required", "The goal \"" + key + "\" needs a value.", key);
                }
            }
        }
        if (state.Guard)
        {
            Guard.Check("goal", wire);
        }
    }

    /// <summary><c>POST /v1/goals/events</c> for one checked wire event; notes an <c>unknown_goal</c> refusal (a debug line).</summary>
    internal static async Task<JsonNode?> SendWireAsync(Core core, JsonObject wire, RequestOptions? options, CancellationToken cancellationToken)
    {
        JsonNode? data;
        try
        {
            (_, data, _) = await core.Requester.RequestAsync(SendRequest(wire, options), cancellationToken).ConfigureAwait(false);
        }
        catch (ClikgateException e)
        {
            core.NoteRefusedGoal(Json.Str(wire["goal"]), e.Code);
            throw;
        }
        core.NoteRefusedGoal(Json.Str(wire["goal"]), data is JsonObject o ? Json.Str(o["reason"]) : null);
        return data;
    }

    internal static ApiRequest SendRequest(JsonObject wire, RequestOptions? options) =>
        // A random Idempotency-Key per call (the requester's default), reused across its retries.
        new ApiRequest("POST", "/v1/goals/events").WithBody(wire).With(options);

    /// <summary>
    /// Sends one goal event and waits for the result. Retries are safe: each call sends a random
    /// <c>Idempotency-Key</c>, reused across its retries, and the API ignores a second event with the same goal and
    /// reference, so a resend never counts twice.
    /// </summary>
    /// <example>
    /// <code>
    /// var ev = await clikgate.Goals.SendAsync("account_opened", new GoalOptions { ClickId = clickId, Reference = "APP-55231", Value = 2_000_000m, Currency = "NGN" });
    /// if (ev.Counted) Console.WriteLine(ev.AttributedTo);
    /// </code>
    /// </example>
    /// <exception cref="InvalidRequestException">Local validation or a 4xx (<see cref="PrivateModeFieldRejectedException"/> in private mode).</exception>
    public async Task<GoalEvent> SendAsync(string key, GoalOptions options, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var wire = Wire(key, options);
        CheckBeforeSend(_core, await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false), wire);
        var data = await SendWireAsync(_core, wire, requestOptions, cancellationToken).ConfigureAwait(false);
        return new GoalEvent(data as JsonObject);
    }

    /// <summary>Sends up to 500 goal events in one request. Per-event failures are returned, not thrown.</summary>
    /// <example>
    /// <code>
    /// var result = await clikgate.Goals.SendBatchAsync([
    ///     new GoalBatchEvent { Goal = "order_paid", Reference = "ORD-1001", ClickId = clickId, Value = "1500.50" },
    ///     new GoalBatchEvent { Goal = "order_paid", Reference = "ORD-1002", Value = 99.90m },
    /// ]);
    /// </code>
    /// </example>
    /// <exception cref="InvalidRequestException">An event fails local validation (with <see cref="InvalidRequestException.Index"/>), or the batch is empty or too large.</exception>
    public async Task<GoalBatchResult> SendBatchAsync(IReadOnlyList<GoalBatchEvent> events, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        if (events is null || events.Count == 0)
        {
            throw Errors.Local("batch_empty", "Send at least one event.", "events");
        }
        if (events.Count > 500)
        {
            throw Errors.Local("batch_too_large", "A batch takes at most 500 events.", "events");
        }
        var wires = new List<JsonObject>();
        for (var i = 0; i < events.Count; i++)
        {
            try
            {
                wires.Add(Wire(events[i].Goal, events[i]));
            }
            catch (InvalidRequestException e)
            {
                e.Index = i;
                throw;
            }
        }
        var state = await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false);
        for (var i = 0; i < wires.Count; i++)
        {
            try
            {
                CheckBeforeSend(_core, state, wires[i]);
            }
            catch (InvalidRequestException e)
            {
                e.Index = i;
                throw;
            }
        }
        var body = new JsonObject { ["events"] = new JsonArray(wires.Select(w => (JsonNode)w).ToArray()) };
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/goals/events/batch").WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        _core.NoteRefusedItems(wires, data);
        return new GoalBatchResult(data as JsonObject);
    }

    /// <summary>Reverses a goal event fully (no value) or partly (a refund, a cancelled loan, a chargeback). <paramref name="reason"/> is refused in private mode.</summary>
    /// <example>
    /// <code>
    /// await clikgate.Goals.ReverseAsync("loan_disbursed", "LN-2201");
    /// await clikgate.Goals.ReverseAsync("order_paid", "ORD-1001", value: 500m);
    /// </code>
    /// </example>
    public async Task<GoalEvent> ReverseAsync(string key, string reference, MoneyValue? value = null, string? reason = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var wire = new JsonObject { ["goal"] = CheckKey(key), ["reference"] = CheckReference(reference) };
        if (value is { } v)
        {
            wire["value"] = v.Wire;
        }
        if (reason is not null)
        {
            wire["reason"] = reason;
        }
        if ((await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false)).Guard)
        {
            Guard.Check("reversal", wire);
        }
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/goals/events/reverse").WithBody(wire).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new GoalEvent(data as JsonObject);
    }
}
