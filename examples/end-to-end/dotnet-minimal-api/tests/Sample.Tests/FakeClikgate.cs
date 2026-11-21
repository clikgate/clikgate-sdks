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
    private readonly ConcurrentDictionary<string, int> _referrersByCustomer = new();
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
            _ when ReferrersPath().IsMatch(path) => Referrer(Uri.UnescapeDataString(path.Split('/')[3]), body["customer_user_id"]?.GetValue<string>() ?? ""),
            _ => (404, Json("""{"error":{"code":"not_found","message":"Not in the fake."}}""")),
        };
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync(answer.ToJsonString());
    }

    /// <summary>Same customer, same referrer and code: 201 the first time, 200 after that, like the API.</summary>
    private (int, JsonNode) Referrer(string programId, string customerUserId)
    {
        var created = !_referrersByCustomer.ContainsKey(customerUserId);
        var n = _referrersByCustomer.GetOrAdd(customerUserId, _ => _referrersByCustomer.Count + 1);
        return (created ? 201 : 200, ReferrerObject(n, programId, customerUserId));
    }

    /// <summary>A referrer as the API returns it (<c>POST /v1/referral-programs/{id}/referrers</c>).</summary>
    public static JsonObject ReferrerObject(int n, string programId, string customerUserId)
    {
        var code = $"TANGO{n}";
        return new JsonObject
        {
            ["id"] = $"rfr_01JCK8Z9V7Q4M2N6P8R0S2T4R{n}",
            ["object"] = "referrer",
            ["program_id"] = programId,
            ["customer_user_id"] = customerUserId,
            ["display_name"] = null,
            ["code"] = code,
            ["external_code"] = null,
            ["link_id"] = "lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA",
            ["url"] = $"https://go.example.com/r/{code}",
            ["short_url"] = $"https://go.example.com/{code.ToLowerInvariant()}",
            ["status"] = "active",
            ["blocked_reason"] = null,
            ["blocked_at"] = null,
            ["stats"] = new JsonObject
            {
                ["clicks"] = 0, ["installs"] = 0, ["signups"] = 0, ["in_progress"] = 0, ["qualified"] = 0,
                ["disqualified"] = 0, ["rejected"] = 0, ["referee_uninstall_rate_7d"] = null,
            },
            ["attributes"] = new JsonObject(),
            ["leaderboard_opt_out"] = false,
            ["quality_score"] = null,
            ["quality_band"] = null,
            ["last_activity_at"] = null,
            ["created_at"] = "2026-11-02T09:30:00Z",
            ["updated_at"] = "2026-11-02T09:30:00Z",
            ["livemode"] = false,
        };
    }

    /// <summary>
    /// A <c>referral.qualified</c> or <c>referral.disqualified</c> webhook event as Clikgate sends it: the envelope,
    /// and the referral in <c>data.object</c>.
    /// </summary>
    public static JsonObject ReferralEvent(string eventId, string type, string referralId, string programId, string referrerUserId)
    {
        var qualified = type == "referral.qualified";
        var steps = new JsonArray(new JsonObject
        {
            ["index"] = 0, ["identify"] = true, ["completed_at"] = "2026-11-02T10:00:00Z", ["source_id"] = "identify:user_friend",
        });
        if (qualified)
        {
            steps.Add(new JsonObject
            {
                ["index"] = 1, ["goal"] = "order_paid", ["completed_at"] = "2026-11-03T09:59:00Z",
                ["source_id"] = "goal:cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE",
            });
        }
        var referral = new JsonObject
        {
            ["id"] = referralId,
            ["object"] = "referral",
            ["program_id"] = programId,
            ["referrer_id"] = "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR",
            ["status"] = qualified ? "qualified" : "disqualified",
            ["source"] = "link",
            ["match_type"] = "deterministic",
            ["current_step"] = steps.Count,
            ["steps_completed"] = steps,
            ["step_deadline_at"] = null,
            ["hold_until"] = null,
            ["qualified_at"] = qualified ? "2026-11-03T10:00:00Z" : null,
            ["disqualified_at"] = qualified ? null : "2026-11-03T10:00:00Z",
            ["rejected_at"] = null,
            ["reason"] = qualified ? null : "step_timeout",
            ["reason_detail"] = null,
            ["reason_message"] = null,
            ["fraud_flags"] = new JsonArray(),
            ["referee_uninstalled_after_qualification"] = false,
            ["program"] = new JsonObject { ["id"] = programId, ["name"] = "Invite friends" },
            ["referrer"] = new JsonObject
            {
                ["id"] = "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR", ["customer_user_id"] = referrerUserId, ["code"] = "TANGO1",
            },
            ["referee"] = new JsonObject
            {
                ["install_id"] = "ins_01JCK8Z9V7Q4M2N6P8R0S2T4IN",
                ["installation_id"] = "6a1f0c2e-0000-4000-8000-000000000002",
                ["customer_user_id"] = "user_friend",
            },
            ["link"] = new JsonObject { ["id"] = "lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA" },
            ["click_id"] = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6",
            ["created_at"] = "2026-11-02T09:45:00Z",
            ["updated_at"] = "2026-11-03T10:00:00Z",
            ["livemode"] = false,
        };
        if (qualified)
        {
            referral["reward_snapshot"] = new JsonObject
            {
                ["referrer"] = new JsonObject { ["amount_minor"] = 100000, ["currency"] = "NGN" },
                ["note"] = "Paid by the app",
            };
        }
        return new JsonObject
        {
            ["id"] = eventId,
            ["object"] = "event",
            ["type"] = type,
            ["api_version"] = "2026-10-01",
            ["created_at"] = "2026-11-03T10:00:00Z",
            ["organization_id"] = "org_01JCK8Z9V7Q4M2N6P8R0S2T4OR",
            ["livemode"] = false,
            ["data"] = new JsonObject { ["previous_attributes"] = null, ["object"] = referral },
        };
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
