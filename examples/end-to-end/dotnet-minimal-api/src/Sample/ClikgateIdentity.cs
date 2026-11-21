using Clikgate;

namespace Sample;

/// <summary>
/// Tells Clikgate which of your users is using the app. Two ways, and the sample shows both:
/// Path A, an identity token in every response that says who is signed in (the app passes it to the mobile SDK);
/// Path B, no secret: the app sends its <c>Clikgate-Installation</c> header, and the server calls IdentifyUserAsync.
/// Your app needs only one of them.
/// </summary>
public sealed class ClikgateIdentity(IClikgateClient clikgate, SampleConfig config, ILogger<ClikgateIdentity> log)
{
    // #region identity-token
    /// <summary>
    /// Path A. Signed here with the identity secret, with no network call. Always pass the date the account was
    /// created (never "now" at sign-in), so Clikgate can tell an existing customer from a new one. Make a new token
    /// for each response, never store it, and never log it.
    /// </summary>
    public string? IdentityToken(AppUser user)
    {
        if (config.IdentitySecret is null) return null; // no identity secret configured: the app uses Path B
        return clikgate.CreateIdentityToken(user.Id, null, user.CreatedAt);
    }
    // #endregion

    // #region identify-installation
    /// <summary>
    /// Path B. Call it only after your own sign-in check, with the user from your own session: the header names the
    /// app installation, never the customer. GetClikgateInstallation() is null for a missing or invalid header
    /// (tracking is off on that phone), and then there is nothing to do.
    /// </summary>
    public async Task IdentifyInstallationAsync(AppUser user, HttpContext context)
    {
        if (context.GetClikgateInstallation() is not { } installation) return;
        try
        {
            var parameters = IdentifyUserParams.For(installation, user.Id);
            parameters.CustomerSince = user.CreatedAt;
            await clikgate.IdentifyUserAsync(parameters);
        }
        catch (ClikgateException e)
        {
            // Never block sign-in on this: the app calls /me at its next open, which tries again.
            log.LogWarning("Clikgate IdentifyUserAsync failed: {Code}", e.Code);
        }
    }
    // #endregion
}
