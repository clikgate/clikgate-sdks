using Clikgate;

namespace Sample;

public sealed record Credentials(string Email, string Password);

/// <summary>Sign-up, sign-in and "current user": the three responses that tell the app who is signed in.</summary>
public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/auth/sign-up", SignUp);
        app.MapPost("/auth/sign-in", SignIn);
        app.MapGet("/me", Me);
    }

    private static async Task<IResult> SignUp(Credentials body, HttpContext context, UserStore users, ClikgateIdentity identity, IClikgateClient clikgate)
    {
        var user = users.Create(body.Email, body.Password);
        if (user is null) return Results.Conflict(new { error = "email_taken" });
        await identity.IdentifyInstallationAsync(user, context);
        // #region server-goal
        // A goal only your server knows about. Goal() never throws: it is queued and sent in the background, and the
        // reference (your own ID for the event) makes a resend count once.
        clikgate.Goal("account_opened", new GoalOptions { Reference = user.Id });
        // #endregion
        return Results.Json(Session(user, users, identity), statusCode: StatusCodes.Status201Created);
    }

    private static async Task<IResult> SignIn(Credentials body, HttpContext context, UserStore users, ClikgateIdentity identity)
    {
        var user = users.SignIn(body.Email, body.Password);
        if (user is null) return Results.Json(new { error = "invalid_credentials" }, statusCode: StatusCodes.Status401Unauthorized);
        await identity.IdentifyInstallationAsync(user, context); // only after your own sign-in check succeeded
        return Results.Ok(Session(user, users, identity));
    }

    /// <summary>The app calls this at every open, so it gets a fresh token and Path B runs again within Clikgate's 7 days.</summary>
    private static async Task<IResult> Me(HttpContext context, UserStore users, ClikgateIdentity identity)
    {
        var user = users.FromRequest(context.Request);
        if (user is null) return Results.Json(new { error = "not_signed_in" }, statusCode: StatusCodes.Status401Unauthorized);
        await identity.IdentifyInstallationAsync(user, context);
        return Results.Ok(new { user, clikgateIdentityToken = identity.IdentityToken(user) });
    }

    // Every response that says who is signed in carries the token (null without an identity secret).
    private static object Session(AppUser user, UserStore users, ClikgateIdentity identity) =>
        new { user, accessToken = users.StartSession(user), clikgateIdentityToken = identity.IdentityToken(user) };
}
