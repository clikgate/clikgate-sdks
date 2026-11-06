using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Clikgate.Internal;
using Xunit;

namespace Clikgate.Tests;

public class PaymentsTests
{
    private const string Key = "cg_test_unit000000000000";
    private const string Confirmation = "{\"object\":\"payment_confirmation\",\"id\":\"pcf_1\",\"status\":\"success\",\"amount\":\"7500\",\"amount_minor\":750000,\"match_status\":\"matched\",\"duplicate\":false}";

    private static (ClikgateClient Client, Recorder Recorder) Client(PrivateMode pm = PrivateMode.Off)
    {
        var r = new Recorder { Status = HttpStatusCode.OK, Body = Confirmation };
        return (new ClikgateClient(new ClikgateOptions { ApiKey = Key, HttpClient = new HttpClient(r), PrivateMode = pm, ShutdownHooks = false }), r);
    }

    private static JsonElement El(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public async Task Confirm_sends_the_wire_body_and_returns_the_confirmation()
    {
        var (client, r) = Client();
        await using var _ = client;
        var c = await client.Payments.ConfirmAsync(new PaymentConfirmParams
        {
            Provider = "paystack",
            Reference = "T_ref_001",
            Status = "success",
            Amount = 7500.00m,
            Currency = "NGN",
            OccurredAt = new DateTimeOffset(2026, 10, 28, 11, 0, 0, TimeSpan.FromHours(1)),
            Aliases = [],
            Goal = "order_paid",
        });
        Assert.Equal("pcf_1", c.Id);
        Assert.Equal(750000L, c.AmountMinor);
        Assert.Equal("matched", c.MatchStatus);
        Assert.False(c.Duplicate);
        var (req, body) = r.Requests.Single();
        Assert.Equal("/v1/payments/confirmations", req.RequestUri!.AbsolutePath);
        Assert.True(req.Headers.Contains("Idempotency-Key"));
        Assert.Equal("{\"provider\":\"paystack\",\"reference\":\"T_ref_001\",\"status\":\"success\",\"amount\":\"7500.00\",\"currency\":\"NGN\",\"occurred_at\":\"2026-10-28T10:00:00Z\",\"goal\":\"order_paid\"}", body);
    }

    [Theory]
    [InlineData("Paystack", "T", "success", "invalid_provider")]
    [InlineData("paystack", "", "success", "invalid_reference")]
    [InlineData("paystack", "T", "paid", "invalid_status")]
    public async Task Confirm_validates_locally(string provider, string reference, string status, string code)
    {
        var (client, r) = Client();
        await using var _ = client;
        var e = await Assert.ThrowsAsync<InvalidRequestException>(() => client.Payments.ConfirmAsync(new PaymentConfirmParams { Provider = provider, Reference = reference, Status = status }));
        Assert.Equal(code, e.Code);
        Assert.Null(e.HttpStatus);
        Assert.Empty(r.Requests);
    }

    [Fact]
    public async Task Confirm_amount_rules()
    {
        var (client, r) = Client();
        await using var _ = client;
        var both = await Assert.ThrowsAsync<InvalidRequestException>(() => client.Payments.ConfirmAsync(new PaymentConfirmParams { Provider = "stripe", Reference = "pi_1", Status = "success", Amount = 20m, AmountMinor = 2000 }));
        Assert.Equal("amount_and_amount_minor", both.Code);
        var negative = await Assert.ThrowsAsync<InvalidRequestException>(() => client.Payments.ConfirmAsync(new PaymentConfirmParams { Provider = "stripe", Reference = "pi_1", Status = "success", Amount = -1m }));
        Assert.Equal("invalid_amount", negative.Code);
        Assert.Equal("amount", negative.Param);
        var separators = await Assert.ThrowsAsync<InvalidRequestException>(() => client.Payments.ConfirmAsync(new PaymentConfirmParams { Provider = "stripe", Reference = "pi_1", Status = "success", Amount = "1,500" }));
        Assert.Equal("invalid_amount", separators.Code);
        Assert.Empty(r.Requests);
    }

    [Fact]
    public async Task Private_mode_guard_refuses_extra_fields_before_the_transport()
    {
        var (client, r) = Client(PrivateMode.On);
        await using var _ = client;
        var e = await Assert.ThrowsAsync<PrivateModeFieldRejectedException>(() => client.Payments.ConfirmAsync(new PaymentConfirmParams
        {
            Provider = "paystack",
            Reference = "T_1",
            Status = "success",
            Extra = new Dictionary<string, object?> { ["email"] = "ada@example.com" },
        }));
        Assert.Equal("email", e.Field);
        Assert.DoesNotContain("ada@example.com", e.Message, StringComparison.Ordinal);
        Assert.Empty(r.Requests);
        await client.Payments.ConfirmAsync(new PaymentConfirmParams { Provider = "paystack", Reference = "T_1", Status = "success", Amount = 50m, Currency = "NGN", Aliases = ["A_1"], ClickId = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6", Goal = "order_paid", Test = true });
        Assert.Single(r.Requests);
    }

    [Theory]
    [InlineData("750000", "NGN", "7500")]
    [InlineData("10050", "GHS", "100.5")]
    [InlineData("10000", "XOF", "100")]
    [InlineData("\"5000\"", "NGN", "50")]
    [InlineData("1", "NGN", "0.01")]
    [InlineData("0", "NGN", "0")]
    [InlineData("99999999999999999", "NGN", "999999999999999.99")]
    public void Paystack_amounts_are_exact(string amount, string currency, string expected)
    {
        var body = PaymentHelpers.BuildFromPaystack("{\"data\":{\"reference\":\"T\",\"status\":\"success\",\"amount\":" + amount + ",\"currency\":\"" + currency + "\"}}");
        Assert.Equal(expected, Json.Str(body!["amount"]));
    }

    [Theory]
    [InlineData("1500.25", "1500.25")]
    [InlineData("0.1", "0.1")]
    [InlineData("\"10.70\"", "10.7")]
    [InlineData("1E+3", "1000")]
    [InlineData("123456789012.345678", "123456789012.345678")]
    public void Flutterwave_amounts_never_go_through_a_double(string amount, string expected)
    {
        var body = PaymentHelpers.BuildFromFlutterwave(El("{\"data\":{\"tx_ref\":\"F\",\"status\":\"successful\",\"amount\":" + amount + ",\"currency\":\"NGN\"}}"));
        Assert.Equal(expected, Json.Str(body!["amount"]));
    }

    [Theory]
    [InlineData("\"-5\"")]
    [InlineData("\"abc\"")]
    [InlineData("true")]
    [InlineData("\"\"")]
    public void Bad_amounts_are_omitted(string amount)
    {
        var body = PaymentHelpers.BuildFromMonnify("{\"responseBody\":{\"paymentReference\":\"M\",\"paymentStatus\":\"PAID\",\"amountPaid\":" + amount + "}}");
        Assert.False(body!.ContainsKey("amount"));
        Assert.False(body.ContainsKey("amount_minor"));
    }

    [Fact]
    public void Stripe_zero_decimal_and_two_decimal_compat()
    {
        string? A(string currency, long amount) => Json.Str(PaymentHelpers.BuildFromStripe("{\"id\":\"pi_1\",\"object\":\"payment_intent\",\"status\":\"succeeded\",\"amount_received\":" + amount + ",\"currency\":\"" + currency + "\"}")!["amount"]);
        Assert.Equal("500", A("jpy", 500));
        Assert.Equal("500", A("ugx", 50000));
        Assert.Equal("500", A("isk", 50000));
        Assert.Equal("19.99", A("eur", 1999));
    }

    [Fact]
    public void Helpers_never_read_customer_details()
    {
        var body = PaymentHelpers.BuildFromPaystack("{\"data\":{\"reference\":\"T\",\"status\":\"success\",\"amount\":100,\"currency\":\"NGN\",\"customer\":{\"email\":\"ada@example.com\",\"phone\":\"+2348000000000\"},\"authorization\":{\"last4\":\"4081\"}}}")!;
        Assert.Equal(["provider", "reference", "status", "amount", "currency"], body.Select(kv => kv.Key).ToArray());
        Assert.DoesNotContain("ada@example.com", body.ToJsonString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("\"2026-10-28T10:00:00Z\"", "2026-10-28T10:00:00Z")]
    [InlineData("\"2026-10-28 11:00:00.1239+0100\"", "2026-10-28T10:00:00.123Z")]
    [InlineData("\"2026-10-28T10:00\"", "2026-10-28T10:00:00Z")]
    [InlineData("1793016000", "2026-10-26T12:00:00Z")]
    [InlineData("1793016000500", "2026-10-26T12:00:00.500Z")]
    public void Times_are_utc(string value, string expected)
    {
        var body = PaymentHelpers.BuildFromPaystack("{\"data\":{\"reference\":\"T\",\"status\":\"success\",\"paid_at\":" + value + "}}");
        Assert.Equal(expected, Json.Str(body!["occurred_at"]));
    }

    [Theory]
    [InlineData("\"28/10/2026 10:00:00 AM\"")]
    [InlineData("\"2026-13-40T10:00:00Z\"")]
    [InlineData("\"yesterday\"")]
    public void Unparsable_times_are_omitted(string value)
    {
        var body = PaymentHelpers.BuildFromPaystack("{\"data\":{\"reference\":\"T\",\"status\":\"success\",\"paid_at\":" + value + "}}");
        Assert.False(body!.ContainsKey("occurred_at"));
    }

    [Fact]
    public void Aliases_are_trimmed_deduplicated_and_capped()
    {
        var body = PaymentHelpers.BuildFromFlutterwave("{\"data\":{\"tx_ref\":\"F\",\"status\":\"successful\",\"id\":\" F \",\"flw_ref\":\"FLW-1\"}}")!;
        Assert.Equal("[\"FLW-1\"]", body["aliases"]!.ToJsonString());
    }

    [Fact]
    public async Task From_helper_without_a_reference_warns_and_sends_nothing()
    {
        var r = new Recorder { Status = HttpStatusCode.OK, Body = Confirmation };
        var warnings = new List<string>();
        await using var client = new ClikgateClient(new ClikgateOptions { ApiKey = Key, HttpClient = new HttpClient(r), PrivateMode = PrivateMode.Off, ShutdownHooks = false, Logger = new ListLogger(warnings) });
        Assert.Null(await client.Payments.FromPaystackAsync("{\"status\":false,\"message\":\"Transaction reference not found\"}"));
        Assert.Null(await client.Payments.FromStripeAsync("{\"id\":\"cs_1\",\"object\":\"checkout.session\",\"payment_status\":\"no_payment_required\"}"));
        Assert.Equal(["unrecognised_payment_response"], warnings);
        Assert.Empty(r.Requests);
        var sent = await client.Payments.FromStripeAsync(El("{\"id\":\"pi_1\",\"object\":\"payment_intent\",\"status\":\"succeeded\",\"amount\":2000,\"amount_received\":2000,\"currency\":\"usd\",\"livemode\":false}"), new PaymentHelperOptions { Goal = "order_paid" });
        Assert.NotNull(sent);
        Assert.Equal("{\"provider\":\"stripe\",\"reference\":\"pi_1\",\"status\":\"success\",\"amount\":\"20\",\"currency\":\"USD\",\"test\":true,\"goal\":\"order_paid\"}", r.Requests.Single().Body);
    }

    private sealed class ListLogger(List<string> warnings) : IClikgateLogger
    {
        public void Log(ClikgateLogLevel level, string code, string message)
        {
            if (level == ClikgateLogLevel.Warning)
            {
                warnings.Add(code);
            }
        }
    }
}
