using System.Text.Json.Nodes;
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
    /// Pays referral rewards. The event's <c>data.object</c> is the referral: its <c>id</c>, and the <c>referrer</c>
    /// and <c>referee</c> with their <c>customer_user_id</c> (your own user IDs).
    /// </summary>
    public static void HandleReferralEvent(WebhookEvent webhookEvent, RewardStore rewards)
    {
        // Clikgate SDK 2.1.0: replace with the typed referral event from the SDK instead of reading the JSON
        var referral = webhookEvent.Data?["object"];
        var referralId = Text(referral?["id"]);
        var referrerUserId = Text(referral?["referrer"]?["customer_user_id"]);
        var refereeUserId = Text(referral?["referee"]?["customer_user_id"]);
        if (referralId is null || referrerUserId is null) return; // not a referral we can pay

        if (webhookEvent.Type == "referral.qualified")
            rewards.PayOnce(referralId, referrerUserId, refereeUserId); // final: pay once (in production, queue a job)
        else if (webhookEvent.Type == "referral.disqualified")
            rewards.MarkDisqualified(referralId, referrerUserId, refereeUserId); // pay nothing
    }
    // #endregion

    private static string? Text(JsonNode? node) =>
        node is JsonValue value && value.TryGetValue(out string? text) ? text : null;
}
