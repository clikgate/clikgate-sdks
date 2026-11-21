using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Sample.Tests;

public sealed record RecordedRequest(string Method, string Path, string? Authorization, JsonObject Body);

/// <summary>
/// A local stand-in for the Clikgate API, so the test never calls the real one. It answers the calls this backend
/// makes with the API's response shapes, and records every request for the test to check.
/// </summary>
public sealed partial class FakeClikgate : IAsyncDisposable
{
    public ConcurrentQueue<RecordedRequest> Requests { get; } = new();
    private readonly ConcurrentDictionary<string, string> _codesByCustomer = new();
    private WebApplication? _app;

    public async Task<string> StartAsync()
    {
        var builder = WebApplication.CreateSlimBuilder();
        builder.Logging.ClearProviders();
        _app = builder.Build();
        _app.Urls.Add("http://127.0.0.1:0");
        _app.Run(HandleAsync);
        await _app.StartAsync();
        return _app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
    }

    public IEnumerable<JsonObject> BodiesSentTo(string path) => Requests.Where(r => r.Path == path).Select(r => r.Body);

    public async ValueTask DisposeAsync()
    {
        if (_app is not null) await _app.DisposeAsync();
    }

    private async Task HandleAsync(HttpContext context)
    {
        var path = context.Request.Path.Value ?? "/";
        var text = await new StreamReader(context.Request.Body).ReadToEndAsync();
        var body = string.IsNullOrEmpty(text) ? new JsonObject() : JsonNode.Parse(text)!.AsObject();
        Requests.Enqueue(new RecordedRequest(context.Request.Method, path, context.Request.Headers.Authorization.ToString(), body));

        var (status, answer) = path switch
        {
            "/v1/server-sdk/config" => (200, Json("""{"mode":"test","private_mode":false,"goals":[{"key":"account_opened"},{"key":"order_paid"}]}""")),
            "/v1/people/identify" => (200, Json("""{"object":"person_identified","person_id":"per_fake"}""")),
            "/v1/goals/events" => (201, Json("""{"object":"goal_event","id":"cnv_fake","status":"counted"}""")),
            "/v1/goals/events/batch" => (200, GoalBatch(body)),
            "/v1/payments/confirmations" => (201, PaymentConfirmation(body)),
            _ when ReferrersPath().IsMatch(path) => Referrer(body["customer_user_id"]?.GetValue<string>() ?? ""),
            _ => (404, Json("""{"error":{"code":"not_found","message":"Not in the fake."}}""")),
        };
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(answer.ToJsonString());
    }

    /// <summary>Same customer, same code: 201 the first time, 200 after that, like the API.</summary>
    private (int, JsonNode) Referrer(string customerUserId)
    {
        var created = !_codesByCustomer.ContainsKey(customerUserId);
        var code = _codesByCustomer.GetOrAdd(customerUserId, _ => $"TANGO-{_codesByCustomer.Count + 1}");
        var answer = new JsonObject
        {
            ["object"] = "referrer", ["code"] = code, ["customer_user_id"] = customerUserId,
            ["short_url"] = $"https://go.example.com/r/{code}",
        };
        return (created ? 201 : 200, answer);
    }

    private static JsonNode GoalBatch(JsonObject body)
    {
        var count = body["events"]?.AsArray().Count ?? 0;
        var data = new JsonArray(Enumerable.Range(0, count)
            .Select(i => (JsonNode)new JsonObject
            {
                ["index"] = i, ["ok"] = true, ["status"] = 201,
                ["goal_event"] = Json("""{"object":"goal_event","status":"counted"}"""),
            })
            .ToArray());
        return new JsonObject { ["object"] = "list", ["data"] = data };
    }

    private static JsonNode PaymentConfirmation(JsonObject body)
    {
        var answer = body.DeepClone().AsObject();
        answer["object"] = "payment_confirmation";
        answer["id"] = "pcf_fake";
        answer["match_status"] = "matched";
        answer["duplicate"] = false;
        return answer;
    }

    private static JsonNode Json(string text) => JsonNode.Parse(text)!;

    [GeneratedRegex("^/v1/referral-programs/[^/]+/referrers$")]
    private static partial Regex ReferrersPath();
}
