using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Xunit;
#if !NET472
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
#endif

namespace Clikgate.Tests;

/// <summary>The Clikgate-Installation header: the parser, IdentifyUserParams.Installation and HttpContext.GetClikgateInstallation().</summary>
public class InstallationTests
{
    private const string Key = "cg_test_unit000000000000";
    private const string App = "app_01JCK8Z9V7Q4M2N6P8R0S2T4AP";
    private const string Inst = "6a1f0c2e-0000-4000-8000-000000000001";
    private const string HeaderValue = App + ":" + Inst;

    private static ClikgateClient Client(Recorder r) =>
        new(new ClikgateOptions { ApiKey = Key, HttpClient = new HttpClient(r), PrivateMode = PrivateMode.Off, ShutdownHooks = false, MaxRetries = 0 });

    [Theory]
    [InlineData(HeaderValue)]
    [InlineData("\t" + HeaderValue + "  ")]
    [InlineData("\r\n\v" + HeaderValue + "\f")]
    public void ParseAcceptsTheContractTrimmed(string value)
    {
        var i = Installation.ParseHeader(value);
        Assert.NotNull(i);
        Assert.Equal(App, i!.AppId);
        Assert.Equal(Inst, i.InstallationId);
        Assert.Equal("Clikgate-Installation", Installation.Header);
    }

    public static TheoryData<string?> BadValues() => new()
    {
        App + ":" + "6A1F0C2E-0000-4000-8000-000000000001",
        "app_01jck8z9v7q4m2n6p8r0s2t4ap:" + Inst,
        HeaderValue + ":x",
        App + "::" + Inst,
        App + Inst,
        App + ":",
        ":" + Inst,
        "cli_01JCK8Z9V7Q4M2N6P8R0S2T4AP:" + Inst,
        new string(' ', 70) + HeaderValue,
        HeaderValue + "\n" + HeaderValue,
        HeaderValue + ", " + HeaderValue,
        " " + HeaderValue,
        HeaderValue + " ",
        "",
        "   ",
        new string('x', 10_000),
    };

    [Theory]
    [MemberData(nameof(BadValues))]
    public void ParseRefusesAnythingElse(string? value) => Assert.Null(Installation.ParseHeader(value));

    [Fact]
    public void ParseRefusesNull() => Assert.Null(Installation.ParseHeader(null));

    [Fact]
    public async Task IdentifyUserWithTheHeaderAndWithoutAppId()
    {
        var r = new Recorder { Status = HttpStatusCode.OK, Body = "{\"object\":\"person_identified\",\"person_id\":\"per_1\",\"label_ignored\":null}" };
        await using var c = Client(r);
        await c.IdentifyUserAsync(new IdentifyUserParams { Installation = " " + HeaderValue + " ", CustomerId = "user_42" });
        await c.IdentifyUserAsync(new IdentifyUserParams { InstallationId = Inst, CustomerId = "user_42" });
        await c.IdentifyUserAsync(new IdentifyUserParams { Installation = HeaderValue, InstallationId = "6a1f0c2e-0000-4000-8000-000000000002", CustomerId = "user_42" });
        await c.IdentifyUserAsync(new IdentifyUserParams { Installation = "secret-header-value", ClickId = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6" });
        await c.IdentifyUserAsync(new IdentifyUserParams { AppId = App, InstallationId = Inst, CustomerId = "user_42" });
        await c.IdentifyUserAsync(IdentifyUserParams.For(Installation.ParseHeader(HeaderValue)!, "user_42"));
        var bodies = r.Bodies().Select(b => b!.ToJsonString()).ToList();
        Assert.Equal(
            new[]
            {
                "{\"app_id\":\"" + App + "\",\"installation_id\":\"" + Inst + "\",\"customer_id\":\"user_42\"}",
                "{\"installation_id\":\"" + Inst + "\",\"customer_id\":\"user_42\"}",
                "{\"installation_id\":\"6a1f0c2e-0000-4000-8000-000000000002\",\"customer_id\":\"user_42\"}",
                "{\"click_id\":\"clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6\"}",
                "{\"app_id\":\"" + App + "\",\"installation_id\":\"" + Inst + "\",\"customer_id\":\"user_42\"}",
                "{\"app_id\":\"" + App + "\",\"installation_id\":\"" + Inst + "\",\"customer_id\":\"user_42\"}",
            },
            bodies);
        var none = await Assert.ThrowsAsync<InvalidRequestException>(() => c.IdentifyUserAsync(new IdentifyUserParams { Installation = "secret-header-value" }));
        Assert.Equal("click_id", none.Param);
        Assert.DoesNotContain("secret-header-value", none.Message);
        var appOnly = await Assert.ThrowsAsync<InvalidRequestException>(() => c.IdentifyUserAsync(new IdentifyUserParams { AppId = App }));
        Assert.Equal("installation_id", appOnly.Param);
        Assert.Equal(6, r.Requests.Count);
    }

    [Fact]
    public async Task SeveralAppsIsAConflict()
    {
        var r = new Recorder
        {
            Status = HttpStatusCode.Conflict,
            Body = "{\"error\":{\"type\":\"conflict\",\"code\":\"installation_in_several_apps\",\"message\":\"Send app_id.\",\"param\":\"app_id\",\"request_id\":\"req_1\"}}",
        };
        await using var c = Client(r);
        var e = await Assert.ThrowsAsync<ConflictException>(() => c.IdentifyUserAsync(new IdentifyUserParams { InstallationId = Inst, CustomerId = "user_42" }));
        Assert.Equal("installation_in_several_apps", e.Code);
        Assert.Equal("app_id", e.Param);
        Assert.Equal(409, e.HttpStatus);
    }

#if !NET472
    [Fact]
    public void GetClikgateInstallationReadsTheHeader()
    {
        var ok = new DefaultHttpContext();
        ok.Request.Headers["Clikgate-Installation"] = HeaderValue;
        Assert.Equal(Installation.ParseHeader(HeaderValue), ok.GetClikgateInstallation());

        var lower = new DefaultHttpContext();
        lower.Request.Headers["clikgate-installation"] = HeaderValue;
        Assert.Equal(App, lower.GetClikgateInstallation()!.AppId);

        foreach (var bad in new[] { new StringValues(new string('x', 5000)), new StringValues(App + ":6A1F0C2E-0000-4000-8000-000000000001"), new StringValues(new[] { HeaderValue, HeaderValue }) })
        {
            var ctx = new DefaultHttpContext();
            ctx.Request.Headers["Clikgate-Installation"] = bad;
            Assert.Null(ctx.GetClikgateInstallation());
        }
        Assert.Null(new DefaultHttpContext().GetClikgateInstallation());
    }
#endif
}
