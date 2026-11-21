using Clikgate;

namespace Sample;

/// <summary>What the app gets: the code and the referrer's short link to share.</summary>
public sealed record ReferralCode(string? Code, string? Link);

/// <summary>
/// Gets or creates a user's referrer code in your referral program. The same user always gets the same code,
/// whether your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
/// </summary>
public sealed class ReferralCodes(IClikgateClient clikgate, SampleConfig config)
{
    // #region referral-code
    public async Task<ReferralCode> GetOrCreateReferralCodeAsync(string userId)
    {
        // Your own user ID, exactly as the app's identifyUser sends it. referrer.Created is true the first time.
        var referrer = await clikgate.Referrals.GetOrCreateReferrerAsync(config.ReferralProgramId, userId);
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
