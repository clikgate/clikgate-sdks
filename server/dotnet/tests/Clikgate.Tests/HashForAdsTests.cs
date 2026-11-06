using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Xunit;

namespace Clikgate.Tests;

/// <summary>SPEC 25: hashed email and phone for ad network matching (the website's vectors).</summary>
public class HashForAdsTests
{
    private const string Key = "cg_test_unit000000000000";
    private const string HEmail = "0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed";
    private const string HE164 = "6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c";
    private const string HDigits = "fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17";
    private const string Click = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";

    private static ClikgateClient Client(Recorder r, PrivateMode pm) => new(new ClikgateOptions
    {
        ApiKey = Key,
        HttpClient = new HttpClient(r),
        PrivateMode = pm,
        SendMode = SendMode.Sync,
        ShutdownHooks = false,
    });

    [Fact]
    public void The_documented_vectors()
    {
        var h = HashForAds.Hash("  Ada.Obi@Example.com ", "+234 803 123 4567");
        Assert.Equal(HEmail, h.HashedEmail);
        Assert.Equal(HE164, h.HashedPhoneE164);
        Assert.Equal(HDigits, h.HashedPhoneDigits);
        foreach (var phone in new[] { "00234 (803) 123-4567", "\t+2348031234567\n" })
        {
            var p = HashForAds.Hash(null, phone);
            Assert.Null(p.HashedEmail);
            Assert.Equal(HE164, p.HashedPhoneE164);
            Assert.Equal(HDigits, p.HashedPhoneDigits);
        }
        var e = HashForAds.Hash("ADA.OBI@EXAMPLE.COM", null);
        Assert.Equal(HEmail, e.HashedEmail);
        Assert.Null(e.HashedPhoneE164);
        Assert.Null(e.HashedPhoneDigits);
        var none = HashForAds.Hash(null, null);
        Assert.Null(none.HashedEmail);
        Assert.Null(none.HashedPhoneDigits);
        Assert.DoesNotContain(HEmail, h.ToString(), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("phone", "0803 123 4567")]
    [InlineData("phone", "2348031234567")]
    [InlineData("phone", "+12345")]
    [InlineData("phone", "+0803 123 4567")]
    [InlineData("phone", "+1234567890123456")]
    [InlineData("phone", "")]
    [InlineData("email", "ada.obi.example.com")]
    [InlineData("email", "   ")]
    public void Refused_inputs_are_never_echoed(string field, string input)
    {
        var ex = Assert.Throws<InvalidRequestException>(() => HashForAds.Hash(field == "email" ? input : null, field == "phone" ? input : null));
        Assert.Equal("invalid_argument", ex.Code);
        Assert.Equal(field, ex.Param);
        Assert.Null(ex.HttpStatus);
        if (input.Trim().Length > 0)
        {
            Assert.DoesNotContain(input.Trim(), ex.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Goals_carry_the_hashed_options_and_a_malformed_hash_is_refused_locally()
    {
        var r = new Recorder();
        await using var c = Client(r, PrivateMode.Off);
        await c.Goals.SendAsync("account_opened", new GoalOptions { Reference = "APP-1", ClickId = Click }.WithHashed(HashForAds.Hash("ada.obi@example.com", "+2348031234567")));
        var expected = new JsonObject
        {
            ["goal"] = "account_opened",
            ["reference"] = "APP-1",
            ["click_id"] = Click,
            ["hashed_email"] = HEmail,
            ["hashed_phone_e164"] = HE164,
            ["hashed_phone_digits"] = HDigits,
        };
        Assert.True(JsonNode.DeepEquals(expected, r.Bodies()[0]));

        var bad = new (GoalOptions Options, string Field, string Value)[]
        {
            (new GoalOptions { Reference = "APP-2", HashedEmail = HEmail.ToUpperInvariant() }, "hashed_email", HEmail.ToUpperInvariant()),
            (new GoalOptions { Reference = "APP-2", HashedPhoneE164 = "+2348031234567" }, "hashed_phone_e164", "+2348031234567"),
            (new GoalOptions { Reference = "APP-2", HashedPhoneDigits = HDigits.Substring(1) }, "hashed_phone_digits", HDigits.Substring(1)),
        };
        foreach (var (options, field, value) in bad)
        {
            var ex = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendAsync("account_opened", options));
            Assert.Equal("invalid_hashed_identifier", ex.Code);
            Assert.Equal(field, ex.Param);
            Assert.DoesNotContain(value, ex.Message, StringComparison.Ordinal);
        }
        var batch = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendBatchAsync(new List<GoalBatchEvent>
        {
            new() { Goal = "account_opened", Reference = "APP-1" },
            new() { Goal = "account_opened", Reference = "APP-2", HashedPhoneDigits = "abc" },
        }));
        Assert.Equal("invalid_hashed_identifier", batch.Code);
        Assert.Equal(1, batch.Index);
        var conv = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Conversions.CreateAsync(new Dictionary<string, object?> { ["external_id"] = "ORD-1", ["hashed_email"] = "ada@example.com" }));
        Assert.Equal("invalid_hashed_identifier", conv.Code);
        Assert.Equal("hashed_email", conv.Param);
        Assert.Single(r.Requests);
    }

    [Fact]
    public async Task Private_mode_allows_the_hashed_fields_not_raw_customer_details()
    {
        var r = new Recorder();
        await using var c = Client(r, PrivateMode.On);
        await c.Goals.SendAsync("account_opened", new GoalOptions { Reference = "APP-1", HashedEmail = HEmail });
        r.Body = "{\"object\":\"conversion\",\"id\":\"cnv_1\"}";
        await c.Conversions.CreateAsync(new Dictionary<string, object?> { ["external_id"] = "ORD-1", ["goal"] = "order_paid", ["hashed_phone_e164"] = HE164, ["hashed_phone_digits"] = HDigits });
        await Assert.ThrowsAsync<PrivateModeFieldRejectedException>(() => c.Conversions.CreateAsync(new Dictionary<string, object?>
        {
            ["external_id"] = "ORD-2",
            ["customer"] = new Dictionary<string, object?> { ["email"] = "ada@example.com" },
        }));
        Assert.Equal(2, r.Requests.Count);
        Assert.Equal(HDigits, r.Bodies().Last()!["hashed_phone_digits"]!.GetValue<string>());
    }
}
