using Clikgate;

namespace Sample;

/// <summary>Receives Clikgate webhooks. No sign-in here: the signature check is what protects the route.</summary>
public static class WebhookEndpoints
{
    public static void MapWebhookEndpoints(this WebApplication app) => app.MapPost("/webhooks/clikgate", Receive);

    // #region webhook
    private static async Task<IResult> Receive(HttpRequest request, SampleConfig config, ProcessedEvents processedEvents, RewardStore rewards)
    {
        using var body = new MemoryStream();
        await request.Body.CopyToAsync(body); // the raw bytes: the signature covers exactly what Clikgate sent
        WebhookEvent webhookEvent;
        try
        {
            webhookEvent = Webhooks.Verify(body.ToArray(), request.Headers["Clikgate-Signature"].ToString(), config.WebhookSecret);
        }
        catch (SignatureVerificationException e)
        {
            return Results.BadRequest(new { error = e.Code });
        }
        if (!processedEvents.MarkNew(webhookEvent.Id ?? "")) return Results.Ok(); // a repeat delivery: do nothing
        if (webhookEvent.Type?.StartsWith("referral.", StringComparison.Ordinal) == true)
            HandleReferralEvent(webhookEvent, rewards);
        return Results.Ok(); // answer quickly; Clikgate waits up to 10 seconds
    }
    // #endregion

    // #region referral-event
    /// <summary>
    /// Pays referral rewards. <c>AsReferral()</c> gives the referral: its <c>Id</c>, and the <c>Referrer</c> and
    /// <c>Referee</c> with <c>CustomerId</c> (your own user IDs; the referee's is null until the app identified them).
    /// </summary>
    public static void HandleReferralEvent(WebhookEvent webhookEvent, RewardStore rewards)
    {
        var referral = webhookEvent.AsReferral(); // null for an event that isn't referral.*
        var referrerUserId = referral?.Referrer?.CustomerId;
        if (referral?.Id is not { } referralId || referrerUserId is null) return; // not a referral we can pay
        var refereeUserId = referral.Referee?.CustomerId;

        if (webhookEvent.Type == EventType.REFERRAL_QUALIFIED)
            rewards.PayOnce(referralId, referrerUserId, refereeUserId); // final: pay once (in production, queue a job)
        else if (webhookEvent.Type == EventType.REFERRAL_DISQUALIFIED)
            rewards.MarkDisqualified(referralId, referrerUserId, refereeUserId); // pay nothing
    }
    // #endregion
}
