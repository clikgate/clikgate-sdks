using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>One existing customer for <see cref="KnownCustomers.ImportAsync"/>: your customer ID and, optionally, when they became a customer (only the UTC day is sent).</summary>
public sealed class KnownCustomer
{
    /// <summary>A customer, optionally with the moment they became a customer.</summary>
    public KnownCustomer(string customerId, DateTimeOffset? customerSince = null)
    {
        CustomerId = customerId ?? throw new ArgumentNullException(nameof(customerId));
        CustomerSince = customerSince;
    }

    /// <summary>Your customer ID (never an email or phone number).</summary>
    public string CustomerId { get; }

    /// <summary>When they became your customer, or null (the import date is used).</summary>
    public DateTimeOffset? CustomerSince { get; }
}

/// <summary>The answer of <see cref="KnownCustomers.ImportAsync"/>, summed over every batch.</summary>
public sealed class KnownCustomersImportResult
{
    internal KnownCustomersImportResult(long accepted, long refused, IReadOnlyDictionary<string, long> refusedByReason)
    {
        Accepted = accepted;
        Refused = refused;
        RefusedByReason = refusedByReason;
    }

    /// <summary>Rows kept.</summary>
    public long Accepted { get; }

    /// <summary>Rows refused.</summary>
    public long Refused { get; }

    /// <summary>
    /// Refused rows by reason (<c>looks_like_email</c>, <c>looks_like_phone</c>, <c>looks_like_national_id</c>,
    /// <c>empty</c>, <c>too_long</c>, <c>bad_date</c>, <c>date_out_of_range</c>). Counts only: the API never returns the
    /// refused IDs.
    /// </summary>
    public IReadOnlyDictionary<string, long> RefusedByReason { get; }
}

/// <summary>
/// Known customers (change 26 KC.3): people who were already your customers before you added Clikgate. Clikgate uses
/// them so an existing customer is never counted as a referral or a new customer. It stores a keyed fingerprint of each
/// ID, not the ID itself. Not available in private mode. Scope <c>people:write</c>.
/// </summary>
public sealed class KnownCustomers
{
    /// <summary>The API's batch size; <see cref="ImportAsync"/> splits larger lists.</summary>
    public const int Batch = 10_000;

    private readonly Core _core;

    internal KnownCustomers(Core core) => _core = core;

    /// <summary>
    /// Imports existing customers (<c>POST /v1/known-customers/import</c>) in batches of 10,000. Idempotent per customer
    /// ID. A given idempotency key gets <c>-&lt;batch&gt;</c> appended when there are several batches.
    /// </summary>
    /// <example><code>var r = await clikgate.KnownCustomers.ImportAsync(new[] { new KnownCustomer("u_10482", new DateTimeOffset(2024, 3, 2, 0, 0, 0, TimeSpan.Zero)) });</code></example>
    public async Task<KnownCustomersImportResult> ImportAsync(IEnumerable<KnownCustomer> customers, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        if (customers is null) throw new ArgumentNullException(nameof(customers));
        var rows = new List<JsonObject>();
        foreach (var c in customers)
        {
            if (c is null) throw Errors.Local("invalid_argument", "customers must not contain null.", "customer_id");
            var row = new JsonObject { ["customer_id"] = c.CustomerId };
            if (c.CustomerSince is { } since) row["customer_since"] = since.UtcDateTime.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            rows.Add(row);
        }
        long accepted = 0, refused = 0;
        var reasons = new Dictionary<string, long>(StringComparer.Ordinal);
        if (rows.Count == 0) return new KnownCustomersImportResult(0, 0, reasons);
        if ((await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false)).Guard) throw PrivateModeConflict();
        var several = rows.Count > Batch;
        for (int i = 0, n = 0; i < rows.Count; i += Batch, n++)
        {
            var body = new JsonObject { ["customers"] = new JsonArray(rows.Skip(i).Take(Batch).Select(r => (JsonNode)r.DeepClone()).ToArray()) };
            var request = new ApiRequest("POST", "/v1/known-customers/import").WithBody(body).With(requestOptions);
            if (several && requestOptions?.IdempotencyKey is { } key) request.IdempotencyKey = key + "-" + n.ToString(CultureInfo.InvariantCulture);
            var (_, data, _) = await _core.Requester.RequestAsync(request, cancellationToken).ConfigureAwait(false);
            if (data is not JsonObject o) continue;
            accepted += Number(o["accepted"]);
            refused += Number(o["refused"]);
            if (o["refused_by_reason"] is JsonObject byReason)
            {
                foreach (var kv in byReason)
                {
                    reasons[kv.Key] = (reasons.TryGetValue(kv.Key, out var had) ? had : 0) + Number(kv.Value);
                }
            }
        }
        return new KnownCustomersImportResult(accepted, refused, reasons);
    }

    /// <summary>Removes one imported customer (<c>POST /v1/known-customers/remove</c>; the ID travels in the body, never in a URL). True when one was removed.</summary>
    /// <example><code>var removed = await clikgate.KnownCustomers.RemoveAsync("u_10482");</code></example>
    public async Task<bool> RemoveAsync(string customerId, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(customerId)) throw Errors.Local("invalid_customer_id", "customerId must be a non-empty string.", "customer_id");
        if ((await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false)).Guard) throw PrivateModeConflict();
        var body = new JsonObject { ["customer_id"] = customerId };
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/known-customers/remove").WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return data is JsonObject o && o["removed"] is JsonValue v && v.TryGetValue<bool>(out var removed) && removed;
    }

    private static long Number(JsonNode? node) => node is JsonValue v && v.TryGetValue<long>(out var n) ? n : 0;

    private static ConflictException PrivateModeConflict() =>
        new("Private mode is on: known customers can't be imported or removed.", "private_mode_conflict", null, null, null, null, null);
}
