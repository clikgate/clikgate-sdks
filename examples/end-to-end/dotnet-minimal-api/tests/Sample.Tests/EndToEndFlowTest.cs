using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Clikgate;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Sample.Tests;

/// <summary>The whole flow, from sign-up to a paid referral reward, against a fake Clikgate API.</summary>
public sealed class EndToEndFlowTest
{
    private const string WebhookSecret = "whsec_test_sample_only";
    private const string Installation = "app_01JAB3C4D5E6F7G8H9JKMNPQRS:6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11";

    [Fact]
    public async Task SignUpSignInMePaymentReferralAndRewards()
    {
        await using var clikgateApi = new FakeClikgate();
        var settings = new Dictionary<string, string?>
        {
            ["CLIKGATE_API_KEY"] = "cg_test_sample_only",
            ["CLIKGATE_BASE_URL"] = await clikgateApi.StartAsync(),
            ["CLIKGATE_IDENTITY_SECRET"] = "test-identity-secret-sample-only",
            ["CLIKGATE_WEBHOOK_SECRET"] = WebhookSecret,
            ["CLIKGATE_REFERRAL_PROGRAM_ID"] = "rpg_test_sample",
        };
        await using var app = SampleApp.Create([], settings);
        app.Urls.Add("http://127.0.0.1:0");
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        using var http = new HttpClient { BaseAddress = new Uri(address) };
        http.DefaultRequestHeaders.Add("Clikgate-Installation", Installation);

        // 1. Sign-up: the token carries the account date, and Path B identifies the installation from the header.
        var signUp = await http.PostAsJsonAsync("/auth/sign-up", new { email = "ada@example.com", password = "correct horse" });
        Assert.Equal(HttpStatusCode.Created, signUp.StatusCode);
        var session = await Json(signUp);
        var userId = session["user"]!["id"]!.GetValue<string>();
        var accessToken = session["accessToken"]!.GetValue<string>();
        var createdAt = DateTimeOffset.Parse(session["user"]!["createdAt"]!.GetValue<string>()).ToUnixTimeSeconds();
        AssertTokenHasAccountDate(session["clikgateIdentityToken"], createdAt);

        var identify = clikgateApi.BodiesSentTo("/v1/people/identify").First();
        Assert.Equal("6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11", identify["installation_id"]!.GetValue<string>());
        Assert.Equal("app_01JAB3C4D5E6F7G8H9JKMNPQRS", identify["app_id"]!.GetValue<string>());
        Assert.Equal(userId, identify["customer_id"]!.GetValue<string>());
        Assert.NotNull(identify["customer_since"]);

        // 2. Sign-in: wrong password refused, right password gets a fresh token.
        var wrong = await http.PostAsJsonAsync("/auth/sign-in", new { email = "ada@example.com", password = "nope" });
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        var signIn = await http.PostAsJsonAsync("/auth/sign-in", new { email = "ada@example.com", password = "correct horse" });
        AssertTokenHasAccountDate((await Json(signIn))["clikgateIdentityToken"], createdAt);

        // 3. /me needs the session, and returns a token too.
        Assert.Equal(HttpStatusCode.Unauthorized, (await http.GetAsync("/me")).StatusCode);
        http.DefaultRequestHeaders.Authorization = new("Bearer", accessToken);
        AssertTokenHasAccountDate((await Json(await http.GetAsync("/me")))["clikgateIdentityToken"], createdAt);

        // 4. The server goal from sign-up was queued; flushing sends it.
        Assert.True(await app.Services.GetRequiredService<IClikgateClient>().FlushAsync(TimeSpan.FromSeconds(5)));
        Assert.Contains(clikgateApi.Requests, r => r.Path.StartsWith("/v1/goals/events", StringComparison.Ordinal)
            && r.Body.ToJsonString().Contains("account_opened") && r.Body.ToJsonString().Contains(userId));

        // 5. Payment: confirmed from the (stubbed) gateway's answer, in normal units.
        var payment = await http.PostAsJsonAsync("/payments/paystack/confirm", new { reference = "T123456" });
        Assert.Equal(HttpStatusCode.OK, payment.StatusCode);
        var confirmation = clikgateApi.BodiesSentTo("/v1/payments/confirmations").First();
        Assert.Equal(["paystack", "T123456", "7500", "NGN", "order_paid"],
            new[] { "provider", "reference", "amount", "currency", "goal" }.Select(k => confirmation[k]!.GetValue<string>()));

        // 6. Referral code: the same code on every call.
        var first = await Json(await http.GetAsync("/me/referral"));
        var second = await Json(await http.GetAsync("/me/referral"));
        Assert.False(string.IsNullOrEmpty(first["code"]!.GetValue<string>()));
        Assert.Equal(first["code"]!.GetValue<string>(), second["code"]!.GetValue<string>());
        Assert.StartsWith("https://", first["link"]!.GetValue<string>());
        Assert.Equal(userId, clikgateApi.BodiesSentTo("/v1/referral-programs/rpg_test_sample/referrers").First()["customer_user_id"]!.GetValue<string>());

        // Every call to the API used the server key.
        Assert.All(clikgateApi.Requests, r => Assert.Equal("Bearer cg_test_sample_only", r.Authorization));

        // 7. Webhooks: verified, deduplicated, and the reward is paid once.
        var rewards = app.Services.GetRequiredService<RewardStore>();
        Assert.Equal(HttpStatusCode.OK, await Webhook(http, "evt_1", "referral.qualified", "ref_1", userId));
        Assert.Equal(HttpStatusCode.OK, await Webhook(http, "evt_1", "referral.qualified", "ref_1", userId)); // redelivery
        Assert.Equal(HttpStatusCode.OK, await Webhook(http, "evt_2", "referral.qualified", "ref_1", userId)); // same referral
        Assert.Equal(1, rewards.PaidCount());
        Assert.Equal(userId, rewards.Find("ref_1")!.ReferrerUserId);

        Assert.Equal(HttpStatusCode.OK, await Webhook(http, "evt_3", "referral.disqualified", "ref_2", userId));
        Assert.Equal("disqualified", rewards.Find("ref_2")!.Status);
        Assert.Equal(HttpStatusCode.BadRequest, await Webhook(http, "evt_4", "referral.qualified", "ref_3", userId, "whsec_wrong"));
        Assert.Null(rewards.Find("ref_3"));
        Assert.Equal(1, rewards.PaidCount());

        await app.StopAsync();
    }

    /// <summary>A version 2 token ends with the account date in Unix seconds: signature.issuedAt.customerSince</summary>
    private static void AssertTokenHasAccountDate(JsonNode? token, long createdAtSeconds)
    {
        var parts = token!.GetValue<string>().Split('.');
        Assert.Equal(3, parts.Length);
        Assert.Equal(createdAtSeconds.ToString(), parts[2]);
    }

    private static async Task<HttpStatusCode> Webhook(HttpClient http, string eventId, string type, string referralId, string referrerUserId, string secret = WebhookSecret)
    {
        var body = JsonSerializer.Serialize(new
        {
            id = eventId,
            type,
            data = new { @object = new { id = referralId, referrer = new { customer_user_id = referrerUserId }, referee = new { customer_user_id = "user_friend" } } },
        });
        var t = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var signature = Convert.ToHexStringLower(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes($"{t}.{body}")));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/webhooks/clikgate") { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("Clikgate-Signature", $"t={t},v1={signature}");
        return (await http.SendAsync(request)).StatusCode;
    }

    private static async Task<JsonNode> Json(HttpResponseMessage response) =>
        JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
}
