using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;
using Xunit;

namespace Clikgate.Tests;

/// <summary>A capturing transport: records every request that reaches the HTTP layer.</summary>
internal sealed class Recorder : HttpMessageHandler
{
    public ConcurrentQueue<(HttpRequestMessage Request, string? Body)> Requests { get; } = new();

    public HttpStatusCode Status { get; set; } = HttpStatusCode.Created;

    public string Body { get; set; } = "{\"object\":\"goal_event\",\"id\":\"gev_1\",\"counted\":true}";

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
#if NET472
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync().ConfigureAwait(false);
#else
        var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
#endif
        Requests.Enqueue((request, body));
        return new HttpResponseMessage(Status) { Content = new StringContent(Body, Encoding.UTF8, "application/json") };
    }

    public List<JsonNode?> Bodies() => Requests.Where(r => r.Body is not null).Select(r => JsonNode.Parse(r.Body!)).ToList();
}

public class ClientTests
{
    private const string Key = "cg_test_unit000000000000";
    private static readonly Regex Ua = new("^clikgate-(node|python|php|java|dotnet)/(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?) \\(([a-z]+) ([0-9][0-9A-Za-z.+-]{0,39}); ([^ ]+) ([^)]+)\\)( .*)?$");

    private static ClikgateClient Client(Recorder r, PrivateMode pm, SendMode mode, List<string> errors) => new(new ClikgateOptions
    {
        ApiKey = Key,
        HttpClient = new HttpClient(r),
        PrivateMode = pm,
        SendMode = mode,
        ShutdownHooks = false,
        OnError = (e, ctx) =>
        {
            lock (errors)
            {
                errors.Add(e.Code + " " + string.Join(",", ctx.Events.Select(x => x.Goal + ":" + x.Reference)));
            }
        },
    });

    [Fact]
    public void Money_formats_exactly()
    {
        Assert.Equal("1500.50", Money.FormatValue(1500.50m));
        Assert.Equal("1000", Money.FormatValue(decimal.Parse("1E+3", System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Equal("2000000", Money.FormatValue(2_000_000L));
        Assert.Throws<InvalidRequestException>(() => Money.FormatValue(-1m));
        Assert.Throws<InvalidRequestException>(() => Money.FormatValue("1e3"));
    }

    [Fact]
    public void Goal_event_reads_value_and_value_minor()
    {
        var ev = new GoalEvent(JsonNode.Parse("{\"object\":\"goal_event\",\"value\":\"1500.5\",\"value_minor\":150050,\"currency\":\"NGN\",\"reversed_value\":\"500\",\"reversed_value_minor\":50000}") as JsonObject);
        Assert.Equal("1500.5", ev.Value);
        Assert.Equal(1500.5m, ev.ValueDecimal);
        Assert.Equal(150050L, ev.ValueMinor);
        Assert.Equal("500", ev.ReversedValue);
        Assert.Equal(50000L, ev.ReversedValueMinor);
        Assert.Null(new GoalEvent(new JsonObject()).ValueMinor);
    }

    [Fact]
    public void User_agent_matches_the_judge()
    {
        Assert.Equal("1.8.0-402", UserAgent.Sanitise("1.8.0_402"));
        Assert.Equal("clikgate-dotnet/" + SdkVersion.Value + " (dotnet 4.0.30319.42000; windows x64)", UserAgent.Build("windows", "x64", "4.0.30319.42000"));
        Assert.Matches(Ua, UserAgent.Current());
    }

    [Fact]
    public void Configuration_errors_name_the_key_type_only()
    {
        var e = Assert.Throws<ConfigurationException>(() => new ClikgateClient(new ClikgateOptions { ApiKey = "cg_sdk_secretvalue" }));
        Assert.Equal("invalid_api_key", e.Code);
        Assert.DoesNotContain("secretvalue", e.Message, StringComparison.Ordinal);
        Assert.Equal("invalid_option", Assert.Throws<ConfigurationException>(() => new ClikgateClient(new ClikgateOptions { ApiKey = Key, BaseUrl = "http://example.com" })).Code);
        Assert.Equal("invalid_option", Assert.Throws<ConfigurationException>(() => new ClikgateClient(new ClikgateOptions { ApiKey = Key, Proxy = "socks5://x:1" })).Code);
        using var live = new ClikgateClient(new ClikgateOptions { ApiKey = "cg_live_x", BaseUrl = "http://[::1]:8080/", ShutdownHooks = false });
        Assert.Equal("live", live.Mode);
    }

    [Fact]
    public async Task The_guard_never_reaches_the_transport()
    {
        var r = new Recorder();
        var errors = new List<string>();
        await using var c = Client(r, PrivateMode.On, SendMode.Background, errors);
        var e = await Assert.ThrowsAsync<PrivateModeFieldRejectedException>(() => c.Goals.SendAsync("account_opened", new GoalOptions { Reference = "APP-1", Metadata = new Dictionary<string, object?> { ["email"] = "secret@example.com" } }));
        Assert.Equal("metadata", e.Field);
        Assert.DoesNotContain("secret@example.com", e.Message, StringComparison.Ordinal);
        r.Status = HttpStatusCode.OK;
        r.Body = "{\"object\":\"list\",\"data\":[]}";
        c.Goal("account_opened", new GoalOptions { Reference = "APP-SECRET", Metadata = new Dictionary<string, object?> { ["ads"] = true } });
        c.Goal("account_opened", new GoalOptions { Reference = "APP-OK" });
        Assert.True(await c.FlushAsync(TimeSpan.FromSeconds(5)));
        Assert.Single(r.Requests);
        Assert.Equal("{\"events\":[{\"goal\":\"account_opened\",\"reference\":\"APP-OK\"}]}", r.Bodies()[0]!.ToJsonString());
        Assert.Equal(["private_mode_field_rejected account_opened:[redacted]"], errors);
    }

    [Fact]
    public async Task Goal_never_throws_and_sync_uses_the_goal_key()
    {
        var r = new Recorder();
        var errors = new List<string>();
        await using var c = Client(r, PrivateMode.Off, SendMode.Sync, errors);
        c.Goal("Bad-Key", new GoalOptions { Reference = "R-1" });
        c.Goal("order_paid", new GoalOptions { Reference = "R-1", OccurredAt = null, Value = "-5" });
        c.Goal("account_opened", new GoalOptions { Reference = "APP-55231", Value = 2_000_000m });
        Assert.True(await c.FlushAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(2, errors.Count);
        Assert.StartsWith("invalid_goal_key", errors[0], StringComparison.Ordinal);
        Assert.StartsWith("invalid_value", errors[1], StringComparison.Ordinal);
        var (req, body) = r.Requests.Single();
        var key = req.Headers.GetValues("Idempotency-Key").Single();
        Assert.Matches("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", key);
        Assert.NotEqual("7b8f11b2797939c911ba15ff4dc0be4ba912c0f05039cadac879211e1b4e9958", key);
        Assert.Matches(Ua, string.Join(" ", req.Headers.GetValues("User-Agent")));
        Assert.Equal("{\"goal\":\"account_opened\",\"reference\":\"APP-55231\",\"value\":\"2000000\"}", body);
    }

    [Fact]
    public async Task Background_batches_goals_from_many_threads()
    {
        var r = new Recorder { Status = HttpStatusCode.OK, Body = "{\"object\":\"list\",\"data\":[]}" };
        await using var c = new ClikgateClient(new ClikgateOptions { ApiKey = Key, HttpClient = new HttpClient(r), PrivateMode = PrivateMode.Off, BatchSize = 50, ShutdownHooks = false });
        await Task.WhenAll(Enumerable.Range(0, 8).Select(n => Task.Run(() =>
        {
            for (var i = 0; i < 100; i++)
            {
                c.Goal("order_paid", new GoalOptions { Reference = "T" + n + "-" + i });
            }
        })));
        Assert.True(await c.FlushAsync(TimeSpan.FromSeconds(10)));
        var refs = r.Bodies().SelectMany(b => ((JsonArray)b!["events"]!).Select(e => (string)e!["reference"]!)).ToList();
        Assert.Equal(800, refs.Count);
        Assert.Equal(800, refs.Distinct().Count());
    }

    [Fact]
    public async Task The_api_layer_uses_the_same_pipeline()
    {
        var r = new Recorder { Status = HttpStatusCode.OK, Body = "{\"object\":\"link\",\"id\":\"lnk_1\"}" };
        await using var c = Client(r, PrivateMode.Off, SendMode.Sync, []);
        var link = await c.Api.Links.FetchLinkAsync("lnk_a/b");
        Assert.Equal("lnk_1", (string)link!["id"]!);
        var (req, _) = r.Requests.Single();
        Assert.EndsWith("/v1/links/lnk_a%2Fb", req.RequestUri!.AbsoluteUri, StringComparison.Ordinal);
        Assert.False(req.Headers.Contains("Idempotency-Key"));
    }

    [Fact]
    public async Task Metadata_filter_link_metadata_and_end_goal_value()
    {
        // Change 10: a metadata map is sent as metadata[<key>]=<value>; Link exposes its metadata.
        var r = new Recorder { Status = HttpStatusCode.OK, Body = "{\"object\":\"list\",\"data\":[{\"group\":\"sel_ada\",\"end_goal_value\":{\"NGN\":\"18500.00\"},\"end_goal_value_minor\":{\"NGN\":1850000}}],\"has_more\":false,\"next_cursor\":null}" };
        await using var c = Client(r, PrivateMode.Off, SendMode.Sync, []);
        var page = await c.Api.Analytics.AnalyticsSummaryAsync(new Dictionary<string, object?>
        {
            ["group_by"] = "metadata.product_id",
            ["metadata"] = new Dictionary<string, string> { ["seller_id"] = "sel ada" },
        });
        Assert.EndsWith("/v1/analytics/summary?group_by=metadata.product_id&metadata%5Bseller_id%5D=sel%20ada", r.Requests.Single().Request.RequestUri!.OriginalString, StringComparison.Ordinal);
        // end_goal_value stays a decimal string per currency, next to end_goal_value_minor (X.E10).
        Assert.Equal("18500.00", (string?)page!["data"]![0]!["end_goal_value"]!["NGN"]);

        r.Body = "{\"object\":\"link\",\"id\":\"lnk_1\",\"external_reference\":\"sel_ada:prd_1\",\"metadata\":{\"seller_id\":\"sel_ada\"}}";
        var link = await c.Links.GetAsync("lnk_1");
        Assert.Equal("sel_ada", (string?)link.Metadata["seller_id"]);
        Assert.Equal("sel_ada:prd_1", link.ExternalReference);
        r.Body = "{\"object\":\"link\",\"id\":\"lnk_2\"}";
        Assert.Empty((await c.Links.GetAsync("lnk_2")).Metadata);

        // A JsonObject map works too.
        await c.Api.Links.ListLinksAsync(new Dictionary<string, object?> { ["metadata"] = new JsonObject { ["seller_id"] = "sel_ada" } });
        Assert.EndsWith("/v1/links?metadata%5Bseller_id%5D=sel_ada", r.Requests.Last().Request.RequestUri!.OriginalString, StringComparison.Ordinal);
    }

    [Fact]
    public void Webhooks_verify_without_a_client()
    {
        const string body = "{\"id\":\"evt_1\",\"object\":\"event\",\"type\":\"goal.completed\",\"data\":{\"object\":{}}}";
        const long t = 1_793_016_000;
        using var hmac = new System.Security.Cryptography.HMACSHA256(Encoding.UTF8.GetBytes("whsec_x"));
        var sig = string.Concat(hmac.ComputeHash(Encoding.UTF8.GetBytes(t + "." + body)).Select(b => b.ToString("x2", System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Equal("evt_1", Webhooks.Verify(body, "t=" + t + ",v1=" + sig, "whsec_x", 300, t).Id);
    }
}
