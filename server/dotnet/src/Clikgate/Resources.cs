using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>Conversions: the older API. New integrations should use goals.</summary>
public sealed class Conversions
{
    private readonly Core _core;

    internal Conversions(Core core) => _core = core;

    private static JsonObject WithValue(IDictionary<string, object?>? parameters)
    {
        var body = Json.ToNode(parameters ?? new Dictionary<string, object?>()) as JsonObject ?? [];
        if (parameters is not null && parameters.TryGetValue("value", out var v) && v is not null)
        {
            body["value"] = Money.FormatObject(v is MoneyValue m ? m.Wire : v);
        }
        return body;
    }

    /// <summary>
    /// Reports a conversion (<c>POST /v1/conversions</c>); <paramref name="parameters"/> use the API's field names. In private mode only
    /// <c>external_id</c>, <c>goal</c>, <c>click_id</c>, <c>code</c>, <c>reference</c>, <c>value</c>, <c>currency</c>, <c>provider</c>, <c>is_first</c>, <c>occurred_at</c>,
    /// <c>consent</c>, <c>kept_by</c>, <c>browser_engine</c>, <c>platform</c> and the hashed identifiers <c>hashed_email</c>, <c>hashed_phone_e164</c>,
    /// <c>hashed_phone_digits</c> (64 lowercase hex; <see cref="HashForAds.Hash(string?, string?)"/>) are allowed. A hashed identifier that isn't
    /// 64 lowercase hex characters is refused locally (<c>invalid_hashed_identifier</c>).
    /// With <c>goal</c> set to a Payment goal this is a trusted payment confirmation: send <c>provider</c> and the payment reference
    /// (<c>external_id</c>); the answer is then the goal event (<see cref="Conversion.IsGoalEvent"/>, <see cref="Conversion.AsGoalEvent"/>).
    /// </summary>
    /// <example><code>await clikgate.Conversions.CreateAsync(new Dictionary&lt;string, object?&gt; { ["external_id"] = "ORD-1001", ["goal"] = "order_paid", ["value"] = 1500.50m });</code></example>
    public async Task<Conversion> CreateAsync(IDictionary<string, object?> parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var body = WithValue(parameters);
        HashForAds.CheckWire(body);
        if ((await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false)).Guard)
        {
            Guard.Check("conversion", body);
        }
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/conversions").WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Conversion(data as JsonObject);
    }

    /// <summary>Reverses a conversion, fully or partly (<c>amount_minor</c>).</summary>
    /// <example><code>await clikgate.Conversions.ReverseAsync("cnv_01J…", new Dictionary&lt;string, object?&gt; { ["amount_minor"] = 200000 });</code></example>
    public async Task<Conversion> ReverseAsync(string id, IDictionary<string, object?>? parameters = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var body = WithValue(parameters);
        if ((await _core.GuardStateAsync(cancellationToken).ConfigureAwait(false)).Guard)
        {
            Guard.Check("reversal", body);
        }
        var path = "/v1/conversions/" + Requester.EncodePathSegment(Requester.RequireId(id, "id")) + "/reverse";
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", path).WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Conversion(data as JsonObject);
    }
}

/// <summary>Links: create, read, update (with approvals and locks), list and QR codes. Parameters use the API's field names.</summary>
public sealed class Links
{
    private readonly Core _core;

    internal Links(Core core) => _core = core;

    private static string PathOf(string id) => "/v1/links/" + Requester.EncodePathSegment(Requester.RequireId(id, "id"));

    /// <summary>Creates a link. Its warnings include <c>no_preview</c> when there is no preview title and image.</summary>
    /// <example><code>var link = await clikgate.Links.CreateAsync(new Dictionary&lt;string, object?&gt; { ["destination_url"] = "https://example.com/spring" });</code></example>
    public async Task<Link> CreateAsync(IDictionary<string, object?> parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/links").WithBody(parameters).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Link(data as JsonObject);
    }

    /// <summary>Fetches a link by ID.</summary>
    /// <example><code>var link = await clikgate.Links.GetAsync("lnk_01J…");</code></example>
    public async Task<Link> GetAsync(string id, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("GET", PathOf(id)).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Link(data as JsonObject);
    }

    /// <summary>
    /// Updates a link; a null value clears a field. With two-person approval on, a destination change answers <c>202</c> and
    /// <see cref="LinkUpdateResult.Applied"/> is false. A locked link throws <see cref="LinkLockedException"/>.
    /// </summary>
    /// <example><code>var r = await clikgate.Links.UpdateAsync("lnk_01J…", new Dictionary&lt;string, object?&gt; { ["destination_url"] = "https://example.com/summer" });</code></example>
    public async Task<LinkUpdateResult> UpdateAsync(string id, IDictionary<string, object?> parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var (status, data, _) = await _core.Requester.RequestAsync(new ApiRequest("PATCH", PathOf(id)).WithBody(parameters).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return status == 202 ? new LinkUpdateResult(false, null, new LinkChangeRequest(data as JsonObject)) : new LinkUpdateResult(true, new Link(data as JsonObject), null);
    }

    /// <summary>Fetches one page of links (<c>limit</c> 1-100, <c>starting_after</c>, <c>ending_before</c>, <c>status</c>, <c>tag</c>, …).</summary>
    /// <example><code>var page = await clikgate.Links.ListPageAsync(new Dictionary&lt;string, object?&gt; { ["limit"] = 100 });</code></example>
    public async Task<LinkPage> ListPageAsync(IDictionary<string, object?>? parameters = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("GET", "/v1/links", parameters).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new LinkPage(data as JsonObject);
    }

    /// <summary>Every link, fetching pages lazily.</summary>
    /// <example><code>await foreach (var link in clikgate.Links.ListAsync(new Dictionary&lt;string, object?&gt; { ["limit"] = 100 })) Console.WriteLine(link.ShortUrl);</code></example>
    public async IAsyncEnumerable<Link> ListAsync(IDictionary<string, object?>? parameters = null, RequestOptions? requestOptions = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string? cursor = null;
        while (true)
        {
            var p = new Dictionary<string, object?>(parameters ?? new Dictionary<string, object?>());
            if (cursor is not null)
            {
                p["starting_after"] = cursor;
            }
            var page = await ListPageAsync(p, requestOptions, cancellationToken).ConfigureAwait(false);
            foreach (var link in page.Data)
            {
                yield return link;
            }
            if (!page.HasMore || string.IsNullOrEmpty(page.NextCursor))
            {
                yield break;
            }
            cursor = page.NextCursor;
        }
    }

    /// <summary>Downloads the link's QR code (<c>format</c> svg|png, <c>size</c> 256-2048, <c>margin</c>, <c>dark</c>, <c>light</c>).</summary>
    /// <example><code>var qr = await clikgate.Links.QrAsync("lnk_01J…", new Dictionary&lt;string, object?&gt; { ["format"] = "png" });</code></example>
    public async Task<BinaryResponse> QrAsync(string id, IDictionary<string, object?>? options = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var res = await _core.Requester.SendAsync(new ApiRequest("GET", PathOf(id) + "/qr", options).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new BinaryResponse(res.Headers.TryGetValue("content-type", out var t) ? t : "application/octet-stream", res.Body);
    }
}

/// <summary>Clicks.</summary>
public sealed class Clicks
{
    private readonly Core _core;

    internal Clicks(Core core) => _core = core;

    /// <summary>Fetches a click by its ID (<c>clk_…</c>).</summary>
    /// <example><code>var click = await clikgate.Clicks.GetAsync(clickId);</code></example>
    public async Task<Click> GetAsync(string clickId, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var path = "/v1/clicks/" + Requester.EncodePathSegment(Requester.RequireId(clickId, "click_id"));
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("GET", path).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Click(data as JsonObject);
    }
}
