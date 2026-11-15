using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Xunit;

namespace Clikgate.Tests;

/// <summary>Change 26: identity token version 2, the canonical customer ID, CustomerSince on IdentifyUserAsync, known customers.</summary>
public class ExistingUsersTests
{
    private const string Key = "cg_test_unit000000000000";

    private static JsonElement Load(string file)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "conformance", "vectors", file)))
        {
            dir = dir.Parent;
        }
        Assert.NotNull(dir);
        return JsonDocument.Parse(File.ReadAllText(Path.Combine(dir!.FullName, "conformance", "vectors", file))).RootElement.Clone();
    }

    /// <summary>Answers from a script, then <c>{}</c>.</summary>
    private sealed class ScriptedRecorder(Queue<string> answers) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string? Body)> Requests { get; } = new();

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, System.Threading.CancellationToken cancellationToken)
        {
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync().ConfigureAwait(false);
            lock (Requests)
            {
                Requests.Add((request, body));
            }
            var answer = answers.Count > 0 ? answers.Dequeue() : "{}";
            return new HttpResponseMessage(System.Net.HttpStatusCode.OK) { Content = new StringContent(answer, System.Text.Encoding.UTF8, "application/json") };
        }

        public List<JsonNode?> Bodies() => Requests.Where(r => r.Body is not null).Select(r => JsonNode.Parse(r.Body!)).ToList();
    }

    private static ClikgateClient Client(HttpMessageHandler r, PrivateMode pm) =>
        new(new ClikgateOptions { ApiKey = Key, HttpClient = new HttpClient(r), PrivateMode = pm, ShutdownHooks = false });

    [Fact]
    public void Version2TokensMatchTheSharedVectors()
    {
        var doc = Load("identity-token-vectors.json");
        var n = 0;
        foreach (var v in doc.GetProperty("v2").EnumerateArray())
        {
            Assert.Equal(
                v.GetProperty("token").GetString(),
                IdentityTokens.Create(v.GetProperty("customer_id").GetString()!, v.GetProperty("secret").GetString()!, v.GetProperty("issued_at").GetInt64(), v.GetProperty("customer_since").GetInt64()));
            n++;
        }
        Assert.True(n >= 10);
        foreach (var bad in doc.GetProperty("v2_invalid_customer_since").EnumerateArray())
        {
            var e = Assert.Throws<InvalidRequestException>(() => IdentityTokens.Create("user_42", "cgis_unit", bad.GetProperty("issued_at").GetInt64(), bad.GetProperty("customer_since").GetInt64()));
            Assert.Equal("customer_since", e.Param);
        }
        foreach (var f in doc.GetProperty("forgeries").EnumerateArray())
        {
            Assert.NotEqual(f.GetProperty("real_token").GetString(), f.GetProperty("forged_token").GetString());
        }
    }

    [Fact]
    public void ClientMethodWithADateTimeOffset()
    {
        using var http = new HttpClient(new Recorder());
        var c = new ClikgateClient(new ClikgateOptions { ApiKey = Key, HttpClient = http, ShutdownHooks = false, IdentitySecret = "cgis_VectorOnly0000000000000000000000000000" });
        var token = c.CreateIdentityToken("user_42", null, DateTimeOffset.FromUnixTimeSeconds(1709370000));
        Assert.EndsWith(".1709370000", token);
        Assert.Equal(3, token.Split('.').Length);
    }

    [Fact]
    public void CanonicalCustomerIdsAndWarnings()
    {
        foreach (var v in Load("customer-id-vectors.json").GetProperty("vectors").EnumerateArray())
        {
            var input = v.GetProperty("input").GetString()!;
            Assert.Equal(v.GetProperty("canonical").GetString(), CustomerIds.Canonical(input));
            var warning = v.GetProperty("warning");
            Assert.Equal(warning.ValueKind == JsonValueKind.Null ? null : warning.GetString(), CustomerIds.Warning(input, v.GetProperty("allow_11_digit_ids").GetBoolean()));
        }
    }

    [Fact]
    public async Task IdentifyUserSendsCustomerSince()
    {
        var r = new Recorder { Body = "{\"object\":\"person_identified\",\"person_id\":\"per_1\",\"label_ignored\":null,\"customer_since_ignored\":\"unverified\"}" };
        await using var c = Client(r, PrivateMode.Off);
        var res = await c.IdentifyUserAsync(new IdentifyUserParams { CustomerId = "u_1", CustomerSince = new DateTimeOffset(2024, 3, 2, 10, 0, 0, TimeSpan.FromHours(1)), CustomerSinceReplace = true });
        Assert.Equal("unverified", res.CustomerSinceIgnored);
        var body = r.Bodies()[0]!.AsObject();
        Assert.Equal("2024-03-02T09:00:00Z", (string?)body["customer_since"]);
        Assert.True((bool)body["customer_since_replace"]!);
        var e = await Assert.ThrowsAsync<InvalidRequestException>(() => c.IdentifyUserAsync(new IdentifyUserParams { AppId = "app_1", InstallationId = "i", CustomerSince = DateTimeOffset.UtcNow }));
        Assert.Equal("customer_since", e.Param);
        Assert.Single(r.Requests);
    }

    [Fact]
    public async Task PrivateModeRefusesCustomerSinceAndKnownCustomers()
    {
        var r = new Recorder();
        await using var c = Client(r, PrivateMode.On);
        await Assert.ThrowsAsync<PrivateModeFieldRejectedException>(() => c.IdentifyUserAsync(new IdentifyUserParams { AppId = "app_1", InstallationId = "i", CustomerId = "u_1", CustomerSince = DateTimeOffset.UtcNow }));
        var e = await Assert.ThrowsAsync<ConflictException>(() => c.KnownCustomers.ImportAsync(new[] { new KnownCustomer("u_1") }));
        Assert.Equal("private_mode_conflict", e.Code);
        Assert.Null(e.HttpStatus);
        await Assert.ThrowsAsync<ConflictException>(() => c.KnownCustomers.RemoveAsync("u_1"));
        Assert.Empty(r.Requests);
    }

    [Fact]
    public async Task ImportBatchesBy10000AndSumsCounts()
    {
        var answers = new Queue<string>(new[]
        {
            "{\"accepted\":9990,\"refused\":10,\"refused_by_reason\":{\"looks_like_phone\":10}}",
            "{\"accepted\":9998,\"refused\":2,\"refused_by_reason\":{\"looks_like_phone\":1,\"bad_date\":1}}",
            "{\"accepted\":5,\"refused\":0,\"refused_by_reason\":{}}",
        });
        var r = new ScriptedRecorder(answers);
        await using var c = Client(r, PrivateMode.Off);
        var rows = new List<KnownCustomer>
        {
            new("u_0", new DateTimeOffset(2024, 3, 2, 23, 30, 0, TimeSpan.Zero)),
            new("u_1", DateTimeOffset.FromUnixTimeSeconds(1709337600)),
        };
        rows.AddRange(Enumerable.Range(2, 20003).Select(i => new KnownCustomer("u_" + i)));
        var result = await c.KnownCustomers.ImportAsync(rows, new RequestOptions { IdempotencyKey = "imp-1" });
        Assert.Equal(19993, result.Accepted);
        Assert.Equal(12, result.Refused);
        Assert.Equal(11, result.RefusedByReason["looks_like_phone"]);
        Assert.Equal(1, result.RefusedByReason["bad_date"]);
        Assert.Equal(3, r.Requests.Count);
        var first = r.Bodies()[0]!["customers"]!.AsArray();
        Assert.Equal(10000, first.Count);
        Assert.Equal("{\"customer_id\":\"u_0\",\"customer_since\":\"2024-03-02\"}", first[0]!.ToJsonString());
        Assert.Equal("{\"customer_id\":\"u_1\",\"customer_since\":\"2024-03-02\"}", first[1]!.ToJsonString());
        Assert.Equal("{\"customer_id\":\"u_2\"}", first[2]!.ToJsonString());
        Assert.Equal(new[] { "imp-1-0", "imp-1-1", "imp-1-2" }, r.Requests.Select(x => x.Request.Headers.GetValues("Idempotency-Key").Single()).ToArray());
        Assert.All(r.Requests, x => Assert.EndsWith("/v1/known-customers/import", x.Request.RequestUri!.AbsolutePath));
        Assert.Equal(0, (await c.KnownCustomers.ImportAsync(Array.Empty<KnownCustomer>())).Accepted);
    }

    [Fact]
    public async Task RemoveSendsTheIdInTheBody()
    {
        var r = new Recorder { Body = "{\"removed\":true}", Status = System.Net.HttpStatusCode.OK };
        await using var c = Client(r, PrivateMode.Off);
        Assert.True(await c.KnownCustomers.RemoveAsync("u_10482"));
        var (request, _) = r.Requests.Single();
        Assert.EndsWith("/v1/known-customers/remove", request.RequestUri!.AbsolutePath);
        Assert.DoesNotContain("u_10482", request.RequestUri!.ToString());
        Assert.Equal("u_10482", (string?)r.Bodies()[0]!["customer_id"]);
    }
}
