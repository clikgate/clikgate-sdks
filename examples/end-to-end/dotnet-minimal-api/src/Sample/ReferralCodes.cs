using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace Sample;

public sealed record ReferralCode(string Code, string Link);

/// <summary>
/// Gets or creates a user's referrer code in your referral program. The same user always gets the same code,
/// whether your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
/// </summary>
public sealed class ReferralCodes(HttpClient http, SampleConfig config)
{
    private sealed record Referrer(string Code, [property: JsonPropertyName("short_url")] string ShortUrl);

    // #region referral-code
    public async Task<ReferralCode> GetOrCreateReferralCodeAsync(string userId)
    {
        // Clikgate SDK 2.1.0: replace with clikgate.Referrals.GetOrCreateReferrerAsync(...)
        // Until then: the same API call the SDK will make (201 when created, 200 when it already existed).
        var url = $"{config.BaseUrl}/v1/referral-programs/{Uri.EscapeDataString(config.ReferralProgramId)}/referrers";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            // Your own user ID, exactly as the app's identifyUser sends it.
            Content = JsonContent.Create(new Dictionary<string, string> { ["customer_user_id"] = userId }),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.ApiKey);
        using var response = await http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        var referrer = await response.Content.ReadFromJsonAsync<Referrer>()
            ?? throw new InvalidOperationException("Empty answer from Clikgate");
        return new ReferralCode(referrer.Code, referrer.ShortUrl);
    }
    // #endregion
}

/// <summary>
/// The app calls <c>GET /me/referral</c> when the user opens "Invite friends". The user comes from your own session,
/// so nobody can ask for someone else's code.
/// </summary>
public static class ReferralEndpoints
{
    public static void MapReferralEndpoints(this WebApplication app) =>
        app.MapGet("/me/referral", async (HttpContext context, UserStore users, ReferralCodes referralCodes) =>
            users.FromRequest(context.Request) is { } user
                ? Results.Ok(await referralCodes.GetOrCreateReferralCodeAsync(user.Id)) // {"code": "...", "link": "https://..."}
                : Results.Json(new { error = "not_signed_in" }, statusCode: 401));
}
