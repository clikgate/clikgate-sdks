using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>
/// The parameters of <see cref="Payments.ConfirmAsync"/> (<c>POST /v1/payments/confirmations</c>, SPEC 22.2): the result of
/// your own server's verification with the gateway. <see cref="Provider"/>, <see cref="Reference"/> and <see cref="Status"/> are required.
/// </summary>
/// <example>
/// <code>
/// new PaymentConfirmParams { Provider = Provider.PAYSTACK, Reference = "T_ref_001", Status = "success", Amount = 7500.00m, Currency = "NGN" }
/// </code>
/// </example>
public sealed class PaymentConfirmParams
{
    /// <summary>
    /// The provider, e.g. <c>Provider.PAYSTACK</c>, or its key as a string (<c>"paystack"</c>; also a gateway added after this
    /// SDK release, which the API validates).
    /// </summary>
    public Provider? Provider { get; set; }

    /// <summary>The gateway's canonical payment reference, 1-128 characters.</summary>
    public string? Reference { get; set; }

    /// <summary><c>success</c>, <c>partial</c>, <c>pending</c>, <c>failed</c>, <c>refunded</c> or <c>reversed</c>.</summary>
    public string? Status { get; set; }

    /// <summary>The confirmed amount in normal units (₦7,500 is <c>7500m</c>); for a refund, the amount refunded.</summary>
    public MoneyValue? Amount { get; set; }

    /// <summary>The amount in ISO 4217 minor units, instead of <see cref="Amount"/> (never both).</summary>
    public long? AmountMinor { get; set; }

    /// <summary>ISO 4217 (upper or lower case).</summary>
    public string? Currency { get; set; }

    /// <summary>When the payment happened (defaults to now on the server).</summary>
    public DateTimeOffset? OccurredAt { get; set; }

    /// <summary>When the payment happened, as an RFC 3339 string (sent unchanged).</summary>
    public string? OccurredAtString { get; set; }

    /// <summary>Up to 5 other references of the same payment (a Stripe <c>cs_…</c> next to the <c>pi_…</c>).</summary>
    public IReadOnlyList<string>? Aliases { get; set; }

    /// <summary>The click ID you put in the gateway metadata (<c>cg_click_id</c>), used when no report arrives.</summary>
    public string? ClickId { get; set; }

    /// <summary>A payment goal key (default: the report's goal, else the default payment goal).</summary>
    public string? Goal { get; set; }

    /// <summary>True for a gateway test payment; must match the API key's mode.</summary>
    public bool? Test { get; set; }

    /// <summary>Additional wire fields, merged last (forward compatibility). Checked by the private-mode guard.</summary>
    public IDictionary<string, object?>? Extra { get; set; }
}

/// <summary>Options of the gateway helpers (<see cref="Payments.FromPaystackAsync(JsonElement, PaymentHelperOptions?, RequestOptions?, CancellationToken)"/> …).</summary>
public sealed class PaymentHelperOptions
{
    /// <summary>A payment goal key.</summary>
    public string? Goal { get; set; }

    /// <summary>A click ID; wins over the <c>cg_click_id</c> in the gateway metadata.</summary>
    public string? ClickId { get; set; }
}

/// <summary>A payment confirmation (<c>pcf_…</c>).</summary>
public sealed class PaymentConfirmation(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The confirmation ID.</summary>
    public string? Id => String("id");

    /// <summary>The payment provider: a <see cref="Clikgate.Provider"/> constant, or a newer one (<see cref="Clikgate.Provider.FromString"/>).</summary>
    public Provider? Provider => String("provider") is { } p ? Clikgate.Provider.FromString(p) : (Clikgate.Provider?)null;

    /// <summary>The reference (<c>h:…</c> in private mode).</summary>
    public string? Reference => String("reference");

    /// <summary>The normalised status.</summary>
    public string? Status => String("status");

    /// <summary>The amount in normal units, as a decimal string.</summary>
    public string? Amount => String("amount");

    /// <summary>The amount in minor units.</summary>
    public long? AmountMinor => Raw["amount_minor"] is JsonValue v && v.TryGetValue(out long l) ? l : null;

    /// <summary>The currency.</summary>
    public string? Currency => String("currency");

    /// <summary><c>matched</c>, <c>waiting_for_report</c>, <c>counted_without_report</c>, <c>unattributed</c>, …</summary>
    public string? MatchStatus => String("match_status");

    /// <summary>The matched payment report (<c>prp_…</c>), if any.</summary>
    public string? ReportId => String("report_id");

    /// <summary>True when the API had this confirmation already.</summary>
    public bool? Duplicate => Bool("duplicate");
}

/// <summary>
/// Payments confirmed by your server. Call these <b>right after your own server has verified the payment
/// with the gateway</b>, never with data from the browser or the app. Clikgate counts the payment goal with the confirmed amount
/// when it matches the website's or app's report.
/// </summary>
public sealed class Payments
{
    private static readonly Regex ProviderKey = new("^[a-z][a-z0-9_]{1,29}$", RegexOptions.CultureInvariant);
    private static readonly Regex CurrencyCode = new("^[A-Za-z]{3}$", RegexOptions.CultureInvariant);
    private static readonly string[] Statuses = ["success", "partial", "pending", "failed", "refunded", "reversed"];
    private readonly Core _core;

    internal Payments(Core core) => _core = core;

    /// <summary>Sends a confirmed payment (<c>POST /v1/payments/confirmations</c>). A repeat answers with <see cref="PaymentConfirmation.Duplicate"/> true.</summary>
    /// <example>
    /// <code>
    /// // after your own GET https://api.paystack.co/transaction/verify/{reference} succeeded:
    /// await clikgate.Payments.ConfirmAsync(new PaymentConfirmParams { Provider = Provider.PAYSTACK, Reference = reference, Status = "success", Amount = 7500m, Currency = "NGN" });
    /// </code>
    /// </example>
    /// <exception cref="InvalidRequestException">Local validation (<c>invalid_provider</c>, <c>invalid_status</c>, …) or a 4xx.</exception>
    public async Task<PaymentConfirmation> ConfirmAsync(PaymentConfirmParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var body = Wire(parameters ?? throw new ArgumentNullException(nameof(parameters)));
        return await SendAsync(body, requestOptions, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Confirms a Paystack payment from your verify response (<c>GET /transaction/verify/{reference}</c>, or its <c>data</c>). Null when there is nothing to send.</summary>
    /// <example><code>var verified = await paystack.VerifyAsync(reference); // your own call
    /// await clikgate.Payments.FromPaystackAsync(verified);</code></example>
    public Task<PaymentConfirmation?> FromPaystackAsync(JsonElement response, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Paystack, response, options, requestOptions, cancellationToken);

    /// <summary>As <see cref="FromPaystackAsync(JsonElement, PaymentHelperOptions?, RequestOptions?, CancellationToken)"/>, from the raw JSON text.</summary>
    /// <example><code>await clikgate.Payments.FromPaystackAsync(await httpResponse.Content.ReadAsStringAsync());</code></example>
    public Task<PaymentConfirmation?> FromPaystackAsync(string responseJson, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Paystack, PaymentHelpers.ParseOrNull(responseJson), options, requestOptions, cancellationToken);

    /// <summary>Confirms a Flutterwave payment from your v3 verify response (<c>GET /v3/transactions/{id}/verify</c> or <c>verify_by_reference</c>).</summary>
    /// <example><code>await clikgate.Payments.FromFlutterwaveAsync(verifyJson);</code></example>
    public Task<PaymentConfirmation?> FromFlutterwaveAsync(JsonElement response, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Flutterwave, response, options, requestOptions, cancellationToken);

    /// <summary>As <see cref="FromFlutterwaveAsync(JsonElement, PaymentHelperOptions?, RequestOptions?, CancellationToken)"/>, from the raw JSON text.</summary>
    /// <example><code>await clikgate.Payments.FromFlutterwaveAsync(verifyText);</code></example>
    public Task<PaymentConfirmation?> FromFlutterwaveAsync(string responseJson, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Flutterwave, PaymentHelpers.ParseOrNull(responseJson), options, requestOptions, cancellationToken);

    /// <summary>Confirms a Monnify payment from your transaction status response (<c>GET /api/v2/transactions/{transactionReference}</c>, or its <c>responseBody</c>).</summary>
    /// <example><code>await clikgate.Payments.FromMonnifyAsync(statusJson);</code></example>
    public Task<PaymentConfirmation?> FromMonnifyAsync(JsonElement response, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Monnify, response, options, requestOptions, cancellationToken);

    /// <summary>As <see cref="FromMonnifyAsync(JsonElement, PaymentHelperOptions?, RequestOptions?, CancellationToken)"/>, from the raw JSON text.</summary>
    /// <example><code>await clikgate.Payments.FromMonnifyAsync(statusText);</code></example>
    public Task<PaymentConfirmation?> FromMonnifyAsync(string responseJson, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Monnify, PaymentHelpers.ParseOrNull(responseJson), options, requestOptions, cancellationToken);

    /// <summary>Confirms a Stripe payment from a PaymentIntent (<c>pi_…</c>) or Checkout Session (<c>cs_…</c>) object you retrieved or got in a verified webhook.</summary>
    /// <example><code>await clikgate.Payments.FromStripeAsync(paymentIntentJson);</code></example>
    public Task<PaymentConfirmation?> FromStripeAsync(JsonElement stripeObject, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Stripe, stripeObject, options, requestOptions, cancellationToken);

    /// <summary>As <see cref="FromStripeAsync(JsonElement, PaymentHelperOptions?, RequestOptions?, CancellationToken)"/>, from the raw JSON text (for example <c>paymentIntent.ToJson()</c>).</summary>
    /// <example><code>await clikgate.Payments.FromStripeAsync(paymentIntent.ToJson());</code></example>
    public Task<PaymentConfirmation?> FromStripeAsync(string stripeObjectJson, PaymentHelperOptions? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
        => FromAsync(PaymentHelpers.Gateway.Stripe, PaymentHelpers.ParseOrNull(stripeObjectJson), options, requestOptions, cancellationToken);

    /// <summary>The body <c>FromPaystackAsync</c> would send, or null (no request). See <see cref="PaymentHelpers"/>.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromPaystack(verifyJson);</code></example>
    public JsonObject? BuildFromPaystack(JsonElement response, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromPaystack(response, options);

    /// <summary>The body <c>FromPaystackAsync</c> would send, from the raw JSON text.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromPaystack(verifyText);</code></example>
    public JsonObject? BuildFromPaystack(string responseJson, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromPaystack(responseJson, options);

    /// <summary>The body <c>FromFlutterwaveAsync</c> would send, or null.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromFlutterwave(verifyJson);</code></example>
    public JsonObject? BuildFromFlutterwave(JsonElement response, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromFlutterwave(response, options);

    /// <summary>The body <c>FromFlutterwaveAsync</c> would send, from the raw JSON text.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromFlutterwave(verifyText);</code></example>
    public JsonObject? BuildFromFlutterwave(string responseJson, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromFlutterwave(responseJson, options);

    /// <summary>The body <c>FromMonnifyAsync</c> would send, or null.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromMonnify(statusJson);</code></example>
    public JsonObject? BuildFromMonnify(JsonElement response, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromMonnify(response, options);

    /// <summary>The body <c>FromMonnifyAsync</c> would send, from the raw JSON text.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromMonnify(statusText);</code></example>
    public JsonObject? BuildFromMonnify(string responseJson, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromMonnify(responseJson, options);

    /// <summary>The body <c>FromStripeAsync</c> would send, or null.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromStripe(paymentIntentJson);</code></example>
    public JsonObject? BuildFromStripe(JsonElement stripeObject, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromStripe(stripeObject, options);

    /// <summary>The body <c>FromStripeAsync</c> would send, from the raw JSON text.</summary>
    /// <example><code>var body = clikgate.Payments.BuildFromStripe(paymentIntent.ToJson());</code></example>
    public JsonObject? BuildFromStripe(string stripeObjectJson, PaymentHelperOptions? options = null) => PaymentHelpers.BuildFromStripe(stripeObjectJson, options);

    private async Task<PaymentConfirmation?> FromAsync(PaymentHelpers.Gateway gateway, JsonElement? response, PaymentHelperOptions? options, RequestOptions? requestOptions, CancellationToken ct)
    {
        var (body, silent) = PaymentHelpers.Build(gateway, response, options);
        if (body is null)
        {
            if (!silent)
            {
                _core.Warn("unrecognised_payment_response", "payments.from_" + gateway.ToString().ToLowerInvariant() + ": the response has no reference or a status the helper doesn't know, so nothing was sent. Pass the gateway's verify response (or its data).");
            }
            return null;
        }
        return await SendAsync(body, requestOptions, ct).ConfigureAwait(false);
    }

    private async Task<PaymentConfirmation> SendAsync(JsonObject body, RequestOptions? requestOptions, CancellationToken ct)
    {
        if ((await _core.GuardStateAsync(ct).ConfigureAwait(false)).Guard)
        {
            Guard.Check("payment_confirmation", body);
        }
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/payments/confirmations").WithBody(body).With(requestOptions), ct).ConfigureAwait(false);
        return new PaymentConfirmation(data as JsonObject);
    }

    /// <summary>Validates <see cref="PaymentConfirmParams"/> and builds the wire body (SPEC 22.2).</summary>
    internal static JsonObject Wire(PaymentConfirmParams p)
    {
        if (p.Provider is not { Value: { } providerKey } || !ProviderKey.IsMatch(providerKey))
        {
            throw Errors.Local("invalid_provider", "provider must be a provider key like \"paystack\" (lower case, 2-30 characters).", "provider");
        }
        if (p.Reference is null || p.Reference.Length == 0 || p.Reference.Count(c => !char.IsLowSurrogate(c)) > 128)
        {
            throw Errors.Local("invalid_reference", "reference is required: the gateway's payment reference, 1-128 characters.", "reference");
        }
        if (p.Status is null || Array.IndexOf(Statuses, p.Status) < 0)
        {
            throw Errors.Local("invalid_status", "status must be one of " + string.Join(", ", Statuses) + ".", "status");
        }
        if (p.Amount is not null && p.AmountMinor is not null)
        {
            throw Errors.Local("amount_and_amount_minor", "Send Amount or AmountMinor, not both.", "amount");
        }
        string? amount = null;
        if (p.Amount is { } m)
        {
            try
            {
                amount = m.Wire;
            }
            catch (InvalidRequestException)
            {
                throw Errors.Local("invalid_amount", "amount must be a non-negative decimal in normal units, like 7500.00m.", "amount");
            }
        }
        if (p.AmountMinor is < 0)
        {
            throw Errors.Local("invalid_amount", "amount_minor must not be negative.", "amount_minor");
        }
        if (p.Currency is not null && !CurrencyCode.IsMatch(p.Currency))
        {
            throw Errors.Local("invalid_currency", "currency must be an ISO 4217 code like \"NGN\".", "currency");
        }
        if (p.Aliases is { Count: > 5 })
        {
            throw Errors.Local("invalid_aliases", "aliases takes at most 5 references.", "aliases");
        }
        if (p.Goal is not null)
        {
            Goals.CheckKey(p.Goal);
        }
        var wire = new JsonObject { ["provider"] = providerKey, ["reference"] = p.Reference, ["status"] = p.Status };
        void Put(string k, object? v)
        {
            if (v is not null)
            {
                wire[k] = Json.ToNode(v);
            }
        }
        Put("amount", amount);
        Put("amount_minor", p.AmountMinor);
        Put("currency", p.Currency);
        Put("occurred_at", p.OccurredAtString ?? (p.OccurredAt is { } at ? Dates.Format(at) : null));
        if (p.Aliases is { Count: > 0 })
        {
            wire["aliases"] = new JsonArray(p.Aliases.Select(a => (JsonNode?)JsonValue.Create(a)).ToArray());
        }
        Put("click_id", p.ClickId);
        Put("goal", p.Goal);
        Put("test", p.Test);
        if (p.Extra is not null)
        {
            foreach (var kv in p.Extra)
            {
                Put(kv.Key, kv.Value);
            }
        }
        return wire;
    }
}

/// <summary>
/// The gateway helpers' extraction rules as pure functions: they build the body
/// <see cref="Payments"/> sends, or return null when there is nothing to send. They read only the reference, aliases, status,
/// amount, currency, time, test flag and <c>cg_click_id</c>: never customer details. Numbers are read from the raw JSON text
/// (never through <see cref="double"/>), so amounts stay exact.
/// </summary>
public static class PaymentHelpers
{
    private static readonly string[] StripeZeroDecimal = ["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "VND", "VUV", "XAF", "XOF", "XPF"];
    private static readonly Regex IsoTime = new(
        "^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\\.([0-9]+))?)?(Z|[+-][0-9]{2}:?[0-9]{2})?$",
        RegexOptions.CultureInvariant);

    private static readonly Dictionary<string, string> PaystackStatus = new()
    {
        ["success"] = "success",
        ["failed"] = "failed",
        ["abandoned"] = "failed",
        ["reversed"] = "reversed",
        ["ongoing"] = "pending",
        ["pending"] = "pending",
        ["processing"] = "pending",
        ["queued"] = "pending",
    };

    private static readonly Dictionary<string, string> FlutterwaveStatus = new()
    {
        ["successful"] = "success",
        ["succeeded"] = "success",
        ["failed"] = "failed",
        ["voided"] = "failed",
    };

    private static readonly Dictionary<string, string> MonnifyStatus = new()
    {
        ["PAID"] = "success",
        ["OVERPAID"] = "success",
        ["PARTIALLY_PAID"] = "partial",
        ["FAILED"] = "failed",
        ["CANCELLED"] = "failed",
        ["ABANDONED"] = "failed",
        ["EXPIRED"] = "failed",
        ["PENDING"] = "pending",
        ["REVERSED"] = "reversed",
    };

    private static readonly Dictionary<string, string> StripeIntentStatus = new()
    {
        ["succeeded"] = "success",
        ["canceled"] = "failed",
        ["processing"] = "pending",
    };

    internal enum Gateway
    {
        Paystack,
        Flutterwave,
        Monnify,
        Stripe,
    }

    /// <summary>The body <c>payments.from_paystack</c> sends for a Paystack verify response (or its <c>data</c>), or null.</summary>
    /// <example><code>PaymentHelpers.BuildFromPaystack(verifyJson)?["amount"]; // "403.33" for amount 40333</code></example>
    public static JsonObject? BuildFromPaystack(JsonElement response, PaymentHelperOptions? options = null) => Build(Gateway.Paystack, response, options).Body;

    /// <summary>As <see cref="BuildFromPaystack(JsonElement, PaymentHelperOptions?)"/>, from the raw JSON text.</summary>
    /// <example><code>PaymentHelpers.BuildFromPaystack("{\"data\":{…}}");</code></example>
    public static JsonObject? BuildFromPaystack(string responseJson, PaymentHelperOptions? options = null) => Build(Gateway.Paystack, ParseOrNull(responseJson), options).Body;

    /// <summary>The body <c>payments.from_flutterwave</c> sends for a Flutterwave v3 verify response (or its <c>data</c>), or null.</summary>
    /// <example><code>PaymentHelpers.BuildFromFlutterwave(verifyJson);</code></example>
    public static JsonObject? BuildFromFlutterwave(JsonElement response, PaymentHelperOptions? options = null) => Build(Gateway.Flutterwave, response, options).Body;

    /// <summary>As <see cref="BuildFromFlutterwave(JsonElement, PaymentHelperOptions?)"/>, from the raw JSON text.</summary>
    /// <example><code>PaymentHelpers.BuildFromFlutterwave(verifyText);</code></example>
    public static JsonObject? BuildFromFlutterwave(string responseJson, PaymentHelperOptions? options = null) => Build(Gateway.Flutterwave, ParseOrNull(responseJson), options).Body;

    /// <summary>The body <c>payments.from_monnify</c> sends for a Monnify transaction status response (or its <c>responseBody</c>), or null.</summary>
    /// <example><code>PaymentHelpers.BuildFromMonnify(statusJson);</code></example>
    public static JsonObject? BuildFromMonnify(JsonElement response, PaymentHelperOptions? options = null) => Build(Gateway.Monnify, response, options).Body;

    /// <summary>As <see cref="BuildFromMonnify(JsonElement, PaymentHelperOptions?)"/>, from the raw JSON text.</summary>
    /// <example><code>PaymentHelpers.BuildFromMonnify(statusText);</code></example>
    public static JsonObject? BuildFromMonnify(string responseJson, PaymentHelperOptions? options = null) => Build(Gateway.Monnify, ParseOrNull(responseJson), options).Body;

    /// <summary>The body <c>payments.from_stripe</c> sends for a PaymentIntent or Checkout Session object, or null.</summary>
    /// <example><code>PaymentHelpers.BuildFromStripe(paymentIntentJson);</code></example>
    public static JsonObject? BuildFromStripe(JsonElement stripeObject, PaymentHelperOptions? options = null) => Build(Gateway.Stripe, stripeObject, options).Body;

    /// <summary>As <see cref="BuildFromStripe(JsonElement, PaymentHelperOptions?)"/>, from the raw JSON text.</summary>
    /// <example><code>PaymentHelpers.BuildFromStripe(paymentIntent.ToJson());</code></example>
    public static JsonObject? BuildFromStripe(string stripeObjectJson, PaymentHelperOptions? options = null) => Build(Gateway.Stripe, ParseOrNull(stripeObjectJson), options).Body;

    internal static JsonElement? ParseOrNull(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }
        try
        {
            using var doc = JsonDocument.Parse(json!);
            return doc.RootElement.Clone();
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>Body (or null) and whether a null result is silent (Stripe <c>no_payment_required</c>).</summary>
    internal static (JsonObject? Body, bool Silent) Build(Gateway gateway, JsonElement? input, PaymentHelperOptions? options)
    {
        if (options?.Goal is { } g)
        {
            Goals.CheckKey(g);
        }
        if (input is not { } root)
        {
            return (null, false);
        }
        if (root.ValueKind == JsonValueKind.String && ParseOrNull(root.GetString()) is { } parsed)
        {
            root = parsed;
        }
        if (root.ValueKind != JsonValueKind.Object)
        {
            return (null, false);
        }
        var (body, silent) = gateway switch
        {
            Gateway.Paystack => Paystack(root),
            Gateway.Flutterwave => Flutterwave(root),
            Gateway.Monnify => Monnify(root),
            _ => Stripe(root),
        };
        if (body is null)
        {
            return (null, silent);
        }
        if (options?.Goal is { } goal)
        {
            body["goal"] = goal;
        }
        if (options?.ClickId is { } click)
        {
            body["click_id"] = click;
        }
        return (body, false);
    }

    private static (JsonObject?, bool) Paystack(JsonElement root)
    {
        var d = Unwrap(root, "data");
        var reference = Str(d, "reference");
        var status = Str(d, "status") is { } s && PaystackStatus.TryGetValue(s.ToLowerInvariant(), out var n) ? n : null;
        if (reference is null || status is null)
        {
            return (null, false);
        }
        var b = Body(Provider.PAYSTACK.Value, reference, status, null);
        PutAmount(b, Amount(Prop(d, "amount")), 2);
        PutCurrency(b, Str(d, "currency"));
        PutTime(b, First(d, "paid_at", "paidAt", "created_at"), allowNumber: true);
        if (Prop(d, "domain") is { ValueKind: JsonValueKind.String } domain)
        {
            b["test"] = domain.GetString() == "test";
        }
        PutClick(b, Prop(d, "metadata"));
        return (b, false);
    }

    private static (JsonObject?, bool) Flutterwave(JsonElement root)
    {
        var d = Unwrap(root, "data");
        var reference = Str(d, "tx_ref") ?? Str(d, "reference");
        if (reference is null)
        {
            return (null, false);
        }
        var status = Str(d, "status") is { } s && FlutterwaveStatus.TryGetValue(s.ToLowerInvariant(), out var n) ? n : "pending";
        var b = Body(Provider.FLUTTERWAVE.Value, reference, status, [Str(d, "id"), Str(d, "flw_ref")]);
        PutAmount(b, Amount(Prop(d, "amount")), 0);
        PutCurrency(b, Str(d, "currency"));
        PutTime(b, First(d, "created_at", "created_datetime"), allowNumber: true);
        if (!PutClick(b, Prop(d, "meta")))
        {
            PutClick(b, Prop(d, "meta_data"));
        }
        return (b, false);
    }

    private static (JsonObject?, bool) Monnify(JsonElement root)
    {
        var d = Unwrap(root, "responseBody");
        d = Unwrap(d, "eventData");
        var reference = Str(d, "paymentReference");
        var status = Str(d, "paymentStatus") is { } s && MonnifyStatus.TryGetValue(s.ToUpperInvariant(), out var n) ? n : null;
        if (reference is null || status is null)
        {
            return (null, false);
        }
        var b = Body(Provider.MONNIFY.Value, reference, status, [Str(d, "transactionReference")]);
        PutAmount(b, Amount(Prop(d, "amountPaid")), 0);
        PutCurrency(b, Str(d, "currency") ?? Str(d, "currencyCode"));
        PutTime(b, Prop(d, "paidOn"), allowNumber: false);
        PutClick(b, Prop(d, "metaData"));
        return (b, false);
    }

    private static (JsonObject?, bool) Stripe(JsonElement o)
    {
        var kind = Str(o, "object");
        var currency = Str(o, "currency")?.ToUpperInvariant();
        var shift = currency is not null && Array.IndexOf(StripeZeroDecimal, currency) >= 0 ? 0 : 2;
        JsonObject b;
        if (kind == "payment_intent")
        {
            var reference = Str(o, "id");
            var raw = Str(o, "status")?.ToLowerInvariant();
            var status = raw is null ? null : StripeIntentStatus.TryGetValue(raw, out var n) ? n : raw.StartsWith("requires_", StringComparison.Ordinal) ? "pending" : null;
            if (reference is null || status is null)
            {
                return (null, false);
            }
            b = Body(Provider.STRIPE.Value, reference, status, null);
            var received = Amount(Prop(o, "amount_received"));
            PutAmount(b, received is > 0 ? received : Amount(Prop(o, "amount")), shift);
        }
        else if (kind == "checkout.session")
        {
            var paymentStatus = Str(o, "payment_status")?.ToLowerInvariant();
            if (paymentStatus == "no_payment_required")
            {
                return (null, true);
            }
            var status = paymentStatus == "paid" ? "success" : Str(o, "status")?.ToLowerInvariant() == "expired" ? "failed" : "pending";
            var session = Str(o, "id");
            var intent = Prop(o, "payment_intent") is { ValueKind: JsonValueKind.Object } pi ? Str(pi, "id") : Str(o, "payment_intent");
            var reference = intent ?? session;
            if (reference is null)
            {
                return (null, false);
            }
            b = Body(Provider.STRIPE.Value, reference, status, [session, Str(o, "client_reference_id")]);
            PutAmount(b, Amount(Prop(o, "amount_total")), shift);
        }
        else
        {
            return (null, false);
        }
        PutCurrency(b, currency);
        PutTime(b, Prop(o, "created"), allowNumber: true);
        if (Prop(o, "livemode") is { } live && live.ValueKind is JsonValueKind.True or JsonValueKind.False)
        {
            b["test"] = live.ValueKind == JsonValueKind.False;
        }
        PutClick(b, Prop(o, "metadata"));
        return (b, false);
    }

    private static JsonObject Body(string provider, string reference, string status, string?[]? aliases)
    {
        var b = new JsonObject { ["provider"] = provider, ["reference"] = reference, ["status"] = status };
        if (aliases is not null)
        {
            var list = new List<string>();
            foreach (var a in aliases)
            {
                if (a is not null && a != reference && !list.Contains(a))
                {
                    list.Add(a);
                }
            }
            if (list.Count > 0)
            {
                b["aliases"] = new JsonArray(list.Take(5).Select(a => (JsonNode?)JsonValue.Create(a)).ToArray());
            }
        }
        return b;
    }

    private static JsonElement Unwrap(JsonElement root, string key)
        => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(key, out var inner) && inner.ValueKind == JsonValueKind.Object ? inner : root;

    private static JsonElement? Prop(JsonElement o, string name)
        => o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v : null;

    private static JsonElement? First(JsonElement o, params string[] names)
    {
        foreach (var n in names)
        {
            if (Prop(o, n) is { } v && !(v.ValueKind == JsonValueKind.String && string.IsNullOrWhiteSpace(v.GetString())))
            {
                return v;
            }
        }
        return null;
    }

    /// <summary>A trimmed string, or a number's base-10 text; empty is absent.</summary>
    private static string? Str(JsonElement o, string name)
    {
        if (Prop(o, name) is not { } v)
        {
            return null;
        }
        var s = v.ValueKind switch
        {
            JsonValueKind.String => v.GetString()?.Trim(),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        };
        return string.IsNullOrEmpty(s) ? null : s;
    }

    /// <summary>An exact decimal from a JSON number's raw text or a decimal string; null when absent, unparsable or negative.</summary>
    private static decimal? Amount(JsonElement? e)
    {
        string? text = e switch
        {
            { ValueKind: JsonValueKind.Number } n => n.GetRawText(),
            { ValueKind: JsonValueKind.String } s => s.GetString()?.Trim(),
            _ => null,
        };
        if (string.IsNullOrEmpty(text) || !decimal.TryParse(text, NumberStyles.AllowDecimalPoint | NumberStyles.AllowExponent | NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out var d) || d < 0)
        {
            return null;
        }
        return d;
    }

    /// <summary>The shortest exact decimal: no exponent, no trailing fractional zeros (<c>"7500"</c>, <c>"100.5"</c>).</summary>
    internal static string Shortest(decimal d) => d.ToString("0.############################", CultureInfo.InvariantCulture);

    private static void PutAmount(JsonObject b, decimal? amount, int shift)
    {
        if (amount is { } a)
        {
            b["amount"] = Shortest(shift == 2 ? a / 100m : a);
        }
    }

    private static void PutCurrency(JsonObject b, string? currency)
    {
        if (!string.IsNullOrEmpty(currency))
        {
            b["currency"] = currency!.ToUpperInvariant();
        }
    }

    private static void PutTime(JsonObject b, JsonElement? e, bool allowNumber)
    {
        if (Time(e, allowNumber) is { } t)
        {
            b["occurred_at"] = Dates.Format(t);
        }
    }

    internal static DateTimeOffset? Time(JsonElement? e, bool allowNumber)
    {
        try
        {
            if (allowNumber && e is { ValueKind: JsonValueKind.Number } n && decimal.TryParse(n.GetRawText(), NumberStyles.Float, CultureInfo.InvariantCulture, out var secs))
            {
                var ms = secs > 100_000_000_000m ? secs : secs * 1000m;
                return DateTimeOffset.FromUnixTimeMilliseconds((long)decimal.Truncate(ms));
            }
            if (e is not { ValueKind: JsonValueKind.String } s)
            {
                return null;
            }
            var m = IsoTime.Match(s.GetString()!.Trim());
            if (!m.Success)
            {
                return null;
            }
            int P(int i) => int.Parse(m.Groups[i].Value, CultureInfo.InvariantCulture);
            var offset = TimeSpan.Zero;
            var zone = m.Groups[8].Value;
            if (zone.Length > 1)
            {
                var digits = zone.Substring(1).Replace(":", string.Empty);
                offset = new TimeSpan(int.Parse(digits.Substring(0, 2), CultureInfo.InvariantCulture), int.Parse(digits.Substring(2, 2), CultureInfo.InvariantCulture), 0);
                if (zone[0] == '-')
                {
                    offset = -offset;
                }
            }
            var fraction = m.Groups[7].Success ? int.Parse((m.Groups[7].Value + "00").Substring(0, 3), CultureInfo.InvariantCulture) : 0;
            var seconds = m.Groups[6].Success ? P(6) : 0;
            return new DateTimeOffset(P(1), P(2), P(3), P(4), P(5), seconds, fraction, offset);
        }
        catch (ArgumentException)
        {
            return null;
        }
    }

    /// <summary>Adds <c>metadata.cg_click_id</c> (object or JSON text) when it is a valid click ID.</summary>
    private static bool PutClick(JsonObject b, JsonElement? metadata)
    {
        var meta = metadata;
        if (meta is { ValueKind: JsonValueKind.String } s)
        {
            meta = ParseOrNull(s.GetString());
        }
        if (meta is not { ValueKind: JsonValueKind.Object } o || Str(o, "cg_click_id") is not { } click || !ClickIds.IsValid(click))
        {
            return false;
        }
        b["click_id"] = click;
        return true;
    }
}
