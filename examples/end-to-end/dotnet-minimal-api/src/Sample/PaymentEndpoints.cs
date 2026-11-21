using System.Text.Json;
using Clikgate;

namespace Sample;

public sealed record PaymentRequest(string Reference);

/// <summary>
/// The app reports the payment as a Payment goal (provider and reference). Your server confirms it here, after its
/// own check with the gateway, so Clikgate counts the confirmed amount, never an amount sent from the app.
/// </summary>
public static class PaymentEndpoints
{
    public static void MapPaymentEndpoints(this WebApplication app) => app.MapPost("/payments/paystack/confirm", Confirm);

    /// <summary>
    /// Your server's own check with Paystack. Stubbed in the sample: it answers like a successful
    /// <c>GET https://api.paystack.co/transaction/verify/{reference}</c> for ₦7,500, so the sample runs without a
    /// Paystack account. In your app, make that request with your Paystack secret key and return the JSON body.
    /// </summary>
    public static string VerifyWithPaystack(string reference) => JsonSerializer.Serialize(new
    {
        status = true,
        message = "Verification successful",
        data = new
        {
            status = "success",
            reference,
            amount = 750000, // kobo: Paystack's minor unit
            currency = "NGN",
            paid_at = "2026-11-20T10:15:00.000Z",
            metadata = new { },
        },
    });

    private static async Task<IResult> Confirm(PaymentRequest body, HttpContext context, UserStore users, IClikgateClient clikgate)
    {
        if (users.FromRequest(context.Request) is null) return Results.Json(new { error = "not_signed_in" }, statusCode: 401);
        // #region from-paystack
        var verify = VerifyWithPaystack(body.Reference); // your own check, with your Paystack key
        using var parsed = JsonDocument.Parse(verify);
        if (parsed.RootElement.GetProperty("data").GetProperty("status").GetString() != "success")
            return Results.Json(new { error = "payment_not_successful" }, statusCode: 402);
        // ...give the customer what they paid for, then pass Paystack's answer on. Only the reference, status,
        // amount, currency, time and cg_click_id are sent: never customer details.
        await clikgate.Payments.FromPaystackAsync(parsed.RootElement, new PaymentHelperOptions { Goal = "order_paid" });
        // #endregion
        return Results.Ok(new { status = "paid", reference = body.Reference });
    }
}
