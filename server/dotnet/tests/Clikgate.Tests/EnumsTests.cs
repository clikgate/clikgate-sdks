using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Xunit;

namespace Clikgate.Tests;

public class EnumsTests
{
    [Fact]
    public void Enum_wire_values_and_parse()
    {
        Assert.Equal("payment", GoalKind.PAYMENT.ToWire());
        Assert.Equal("refused", GoalStatus.REFUSED.ToWire());
        Assert.Equal(GoalKind.STANDARD, ClikgateEnums.ParseGoalKind("standard"));
        Assert.Null(ClikgateEnums.ParseGoalKind("subscription"));
        Assert.Null(ClikgateEnums.ParseGoalKind(null));
        Assert.Equal(GoalStatus.WAITING, ClikgateEnums.ParseGoalStatus("waiting"));
        Assert.Null(ClikgateEnums.ParseGoalStatus("deferred"));
    }

    [Fact]
    public void Provider_known_and_newer()
    {
        Assert.Equal("mtn_momo", Provider.MTN_MOMO.Value);
        Assert.Equal(Provider.PAYSTACK, Provider.FromString("paystack"));
        Provider fromString = "stripe";
        Assert.True(fromString == Provider.STRIPE);
        var newer = Provider.FromString("acme_pay");
        Assert.Equal("acme_pay", newer.ToString());
        Assert.DoesNotContain(newer, Provider.Values);
        Assert.Contains(Provider.CUSTOM, Provider.Values);
        Assert.True(newer != Provider.PAYSTACK);
    }

    [Fact]
    public void GoalEvent_typed_properties()
    {
        var ev = new GoalEvent(JsonNode.Parse("{\"status\":\"waiting\",\"reason\":\"waiting_for_confirmation\",\"goal_kind\":\"payment\",\"counted\":false,"
            + "\"value_ignored\":true,\"event_status\":null,\"payment\":{\"confirmation_id\":\"pcf_1\",\"provider\":\"paystack\"}}")!.AsObject());
        Assert.Equal(GoalStatus.WAITING, ev.Status);
        Assert.Equal(GoalKind.PAYMENT, ev.GoalKind);
        Assert.True(ev.ValueIgnored);
        Assert.Null(ev.EventStatus);
        Assert.Equal("pcf_1", (string?)ev.Payment!["confirmation_id"]);

        var future = new GoalEvent(JsonNode.Parse("{\"status\":\"deferred\",\"goal_kind\":\"subscription\",\"future_field\":1,\"event_status\":\"attributed\"}")!.AsObject());
        Assert.Null(future.Status);
        Assert.Null(future.GoalKind);
        Assert.Equal("deferred", (string?)future.Raw["status"]);
        Assert.Equal(1, (int?)future.Raw["future_field"]);
        Assert.Equal("attributed", future.EventStatus);
        Assert.Null(future.Payment);
        Assert.False(future.ValueIgnored);

        var pc = new PaymentConfirmation(new JsonObject { ["provider"] = "acme_pay" });
        Assert.Equal("acme_pay", pc.Provider?.Value);
        Assert.Equal(Provider.STRIPE, new PaymentConfirmation(new JsonObject { ["provider"] = "stripe" }).Provider);
    }

    [Fact]
    public async Task Goal_provider_option_and_validation()
    {
        var r = new Recorder();
        var errors = new List<string>();
        await using var c = new ClikgateClient(new ClikgateOptions
        {
            ApiKey = "cg_test_unit000000000000",
            HttpClient = new HttpClient(r),
            PrivateMode = PrivateMode.On,
            SendMode = SendMode.Sync,
            ShutdownHooks = false,
            OnError = (e, _) =>
            {
                lock (errors)
                {
                    errors.Add(e.Code);
                }
            },
        });
        await c.Goals.SendAsync("order_paid", new GoalOptions { Reference = "T1", Value = 7500m, Provider = Provider.PAYSTACK });
        await c.Goals.SendAsync("order_paid", new GoalOptions { Reference = "T2", Provider = "acme_pay" });
        var bodies = r.Bodies();
        Assert.Equal("paystack", (string?)bodies[0]!["provider"]);
        Assert.Equal("acme_pay", (string?)bodies[1]!["provider"]);

        var e = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Goals.SendAsync("order_paid", new GoalOptions { Reference = "T3", Provider = "PayStack" }));
        Assert.Equal("invalid_provider", e.Code);
        Assert.Equal("provider", e.Param);
        Assert.Null(e.HttpStatus);

        c.Goal("order_paid", new GoalOptions { Reference = "T4", Provider = "mtn-momo" });
        await c.FlushAsync();
        lock (errors)
        {
            Assert.Equal(["invalid_provider"], errors);
        }
        Assert.Equal(2, r.Requests.Count);
    }
}
