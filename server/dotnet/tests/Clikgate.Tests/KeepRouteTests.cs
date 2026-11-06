using System.Collections.Generic;
using System.Linq;
using System.Text;
using Xunit;

namespace Clikgate.Tests;

/// <summary>Change 16: the /cg/keep core, the _cg_kept=s marker and ClickIds.Context (SPEC 13, 13.1).</summary>
public class KeepRouteTests
{
    private const string Cid = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";
    private const string Cookie = "_cg_cgid=" + Cid + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure";
    private const string Marker = "_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure";

    private static byte[] Body(string id, string page) => Encoding.UTF8.GetBytes("{\"click_id\":\"" + id + "\",\"page_click_id\":\"" + page + "\"}");

    private static KeepResponse Keep(ClikgateKeepRoute route, string method, byte[] body, params string[] kv)
    {
        var h = new Dictionary<string, string>(System.StringComparer.OrdinalIgnoreCase) { ["Host"] = "shop.example.com" };
        for (var i = 0; i < kv.Length; i += 2)
        {
            h[kv[i]] = kv[i + 1];
        }
        var r = route.Respond(method, name => h.TryGetValue(name, out var v) ? v : null, body);
        Assert.Equal(new KeyValuePair<string, string>("Cache-Control", "no-store, private"), r.Headers[0]);
        Assert.DoesNotContain(r.Headers, x => x.Key == "Location");
        return r;
    }

    private static string[] Cookies(KeepResponse r) => r.Headers.Where(x => x.Key == "Set-Cookie").Select(x => x.Value).ToArray();

    [Fact]
    public void Same_origin_sets_the_cookie_and_the_marker()
    {
        var r = Keep(new ClickIds().KeepRoute(), "POST", Body(Cid, Cid), "Sec-Fetch-Site", "same-origin");
        Assert.Equal(204, r.Status);
        Assert.Equal([Cookie, Marker], Cookies(r));
        Assert.DoesNotContain("HttpOnly", Cookies(r)[0], System.StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Origin_must_match_the_host_and_port()
    {
        var route = new ClickIds().KeepRoute();
        Assert.Equal(204, Keep(route, "POST", Body(Cid, Cid), "Origin", "https://SHOP.example.com").Status);
        Assert.Equal(204, Keep(route, "POST", Body(Cid, Cid), "Origin", "https://shop.example.com", "X-Forwarded-Host", "shop.example.com, lb.internal", "Host", "lb.internal").Status);
        foreach (var origin in new[] { "https://shop.example.com:8443", "https://evil.example.net", "null" })
        {
            var r = Keep(route, "POST", Body(Cid, Cid), "Origin", origin);
            Assert.Equal(403, r.Status);
            Assert.Empty(Cookies(r));
        }
        Assert.Equal(403, Keep(route, "POST", Body(Cid, Cid)).Status);
        Assert.Equal(403, Keep(route, "POST", Body(Cid, Cid), "Sec-Fetch-Site", "same-site").Status);
        Assert.Equal(403, Keep(route, "POST", Body(Cid, Cid), "Sec-Fetch-Site", "cross-site", "Origin", "https://shop.example.com").Status);
    }

    [Fact]
    public void Only_post_and_only_good_bodies_nothing_echoed()
    {
        var route = new ClickIds().KeepRoute();
        var get = Keep(route, "GET", [], "Sec-Fetch-Site", "same-origin");
        Assert.Equal(405, get.Status);
        Assert.Equal(new KeyValuePair<string, string>("Allow", "POST"), get.Headers[1]);
        var big = Encoding.UTF8.GetBytes("{\"click_id\":\"" + Cid + "\",\"page_click_id\":\"" + Cid + "\",\"pad\":\"" + new string('x', 1000) + "\"}");
        var bad = new[] { Body(Cid, "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W7"), Body("<script>", "<script>"), Body(Cid.ToLowerInvariant(), Cid.ToLowerInvariant()), Encoding.UTF8.GetBytes("[]"), Encoding.UTF8.GetBytes("x"), Encoding.UTF8.GetBytes("{\"click_id\":\"" + Cid + "\",\"click_id\":\"" + Cid + "\",\"page_click_id\":\"" + Cid + "\"}"), big, [] };
        foreach (var b in bad)
        {
            var r = Keep(route, "POST", b, "Sec-Fetch-Site", "same-origin");
            Assert.Equal(400, r.Status);
            Assert.Single(r.Headers);
        }
    }

    [Fact]
    public void Options_and_the_configured_name()
    {
        var route = new ClickIds(() => "ref").KeepRoute(new CookieOptions { Days = 90, Secure = false, Domain = ".example.com" });
        var body = Encoding.UTF8.GetBytes("{\"click_id\":\"" + Cid + "\",\"page_click_id\":\"" + Cid + "\",\"name\":\"session\"}");
        Assert.Equal(["_cg_ref=" + Cid + "; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax", "_cg_kept=s; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax"], Cookies(Keep(route, "POST", body, "Sec-Fetch-Site", "same-origin")));
        foreach (var days in new[] { 0d, 401d, 1.5d })
        {
            var e = Assert.Throws<InvalidRequestException>(() => new ClickIds().KeepRoute(new CookieOptions { Days = days }));
            Assert.Equal("invalid_argument", e.Code);
        }
    }

    [Fact]
    public void Persist_adds_the_marker()
    {
        var set = new List<string>();
        new ClickIds().Persist((_, v) => set.Add(v), Cid);
        Assert.Equal([Cookie, Marker], set);
    }

    [Fact]
    public void Context_and_goal_options()
    {
        var headers = new Dictionary<string, string>
        {
            ["Cookie"] = "_cg_cgid=" + Cid + "; _cg_kept=s",
            ["User-Agent"] = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1",
        };
        var c = new ClickIds().Context("/checkout", headers);
        Assert.Equal((Cid, "server_cookie", "webkit_ios", "ios"), (c.ClickId, c.KeptBy, c.BrowserEngine, c.Platform));
        headers["Cookie"] = "_cg_cgid=" + Cid;
        Assert.Equal("script_cookie", new ClickIds().Context("/", headers).KeptBy);
        Assert.Equal("form", new ClickIds().Context("/", new Dictionary<string, string> { ["clikgate-click-id"] = Cid }).KeptBy);
        var fromUrl = new ClickIds().Context("/?cgid=" + Cid, new Dictionary<string, string>());
        Assert.Null(fromUrl.KeptBy);
        Assert.Equal(("other", "other"), (fromUrl.BrowserEngine, fromUrl.Platform));
        Assert.Equal("safari_mac", ClickIds.ParseBrowserEngine("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"));
        Assert.Equal("linux", ClickIds.ParsePlatform("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0"));

        var wire = Goals.Wire("account_opened", new GoalOptions { Reference = "R-1" }.WithContext(c));
        Assert.Equal(Cid, (string?)wire["click_id"]);
        Assert.Equal("server_cookie", (string?)wire["kept_by"]);
        Assert.Equal("webkit_ios", (string?)wire["browser_engine"]);
        Assert.Equal("ios", (string?)wire["platform"]);
        Assert.Throws<InvalidRequestException>(() => Goals.Wire("account_opened", new GoalOptions { Reference = "R-1", KeptBy = "local_storage" }));
        Internal.Guard.Check("goal", wire); // allowed in private mode
    }
}
