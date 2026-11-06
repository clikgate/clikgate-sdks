#if !NET472
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace Clikgate.Tests;

public class AspNetCoreTests
{
    private const string Cid = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";

    private static ServiceProvider Services()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Clikgate:ApiKey"] = "cg_test_aspnet000", ["Clikgate:PrivateMode"] = "false", ["Clikgate:Timeout"] = "00:00:03" }).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(config);
        services.AddLogging();
        services.AddClikgate();
        services.AddRouting();
        services.AddSingleton(new System.Diagnostics.DiagnosticListener("Clikgate.Tests"));
        return services.BuildServiceProvider();
    }

    private const string Body = "{\"click_id\":\"" + Cid + "\",\"page_click_id\":\"" + Cid + "\"}";

    private static async Task<HttpContext> KeepAsync(RequestDelegate pipeline, ServiceProvider sp, string method, string body, params string[] headers)
    {
        var ctx = new DefaultHttpContext { RequestServices = sp };
        ctx.Request.Method = method;
        ctx.Request.Scheme = "https";
        ctx.Request.Path = "/cg/keep";
        ctx.Request.Headers.Host = "shop.example.com";
        for (var i = 0; i < headers.Length; i += 2)
        {
            ctx.Request.Headers.Append(headers[i], headers[i + 1]);
        }
        ctx.Request.Body = new System.IO.MemoryStream(System.Text.Encoding.UTF8.GetBytes(body));
        var output = new System.IO.MemoryStream();
        ctx.Response.Body = output;
        await pipeline(ctx);
        Assert.Equal("no-store, private", ctx.Response.Headers.CacheControl.ToString());
        Assert.Equal(0, output.Length); // never echoed
        Assert.Equal(0, ctx.Response.Headers.Location.Count);
        return ctx;
    }

    private static RequestDelegate KeepPipeline(ServiceProvider sp, CookieOptions? options = null)
    {
        var app = new ApplicationBuilder(sp);
        app.UseRouting();
        app.UseEndpoints(e => e.MapClikgateKeep("/cg/keep", options));
        app.Run(ctx =>
        {
            ctx.Response.StatusCode = 404;
            return Task.CompletedTask;
        });
        return app.Build();
    }

    [Fact]
    public async Task MapClikgateKeep_sets_the_cookie_and_the_marker()
    {
        await using var sp = Services();
        var pipeline = KeepPipeline(sp, new CookieOptions { Days = 90 });
        var ok = await KeepAsync(pipeline, sp, "POST", Body, "Sec-Fetch-Site", "same-origin");
        Assert.Equal(204, ok.Response.StatusCode);
        Assert.Equal(["_cg_cgid=" + Cid + "; Path=/; Max-Age=7776000; SameSite=Lax; Secure", "_cg_kept=s; Path=/; Max-Age=7776000; SameSite=Lax; Secure"], ok.Response.Headers.SetCookie.ToArray());
        Assert.Equal(204, (await KeepAsync(pipeline, sp, "POST", Body, "Origin", "https://shop.example.com")).Response.StatusCode);
    }

    [Fact]
    public async Task MapClikgateKeep_refuses_other_origins_methods_and_bodies()
    {
        await using var sp = Services();
        var pipeline = KeepPipeline(sp);
        foreach (var origin in new[] { "https://evil.example.net", "https://shop.example.com:8443", "null" })
        {
            var r = await KeepAsync(pipeline, sp, "POST", Body, "Origin", origin);
            Assert.Equal(403, r.Response.StatusCode);
            Assert.Equal(0, r.Response.Headers.SetCookie.Count);
        }
        Assert.Equal(403, (await KeepAsync(pipeline, sp, "POST", Body)).Response.StatusCode);
        Assert.Equal(403, (await KeepAsync(pipeline, sp, "POST", Body, "Sec-Fetch-Site", "cross-site", "Origin", "https://shop.example.com")).Response.StatusCode);
        var get = await KeepAsync(pipeline, sp, "GET", string.Empty, "Sec-Fetch-Site", "same-origin");
        Assert.Equal(405, get.Response.StatusCode);
        Assert.Equal("POST", get.Response.Headers.Allow.ToString());
        foreach (var bad in new[] { "{\"click_id\":\"<script>alert(1)</script>\",\"page_click_id\":\"<script>alert(1)</script>\"}", "[]", "nope", "{\"click_id\":\"" + Cid + "\"}", Body + new string(' ', 1024) })
        {
            var r = await KeepAsync(pipeline, sp, "POST", bad, "Sec-Fetch-Site", "same-origin");
            Assert.Equal(400, r.Response.StatusCode);
            Assert.Equal(0, r.Response.Headers.SetCookie.Count);
        }
        Assert.Throws<InvalidRequestException>(() => KeepPipeline(sp, new CookieOptions { Days = 401 }));
    }

    [Fact]
    public async Task GetClikgateContext_reads_the_marker_and_the_user_agent()
    {
        await using var sp = Services();
        var ctx = new DefaultHttpContext { RequestServices = sp };
        ctx.Request.Headers.Cookie = "_cg_cgid=" + Cid + "; _cg_kept=s";
        ctx.Request.Headers.UserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1";
        var c = ctx.GetClikgateContext();
        Assert.Equal((Cid, "server_cookie", "webkit_ios", "ios"), (c.ClickId, c.KeptBy, c.BrowserEngine, c.Platform));
    }

    [Fact]
    public async Task AddClikgate_reads_the_Clikgate_section_and_flushes_on_stop()
    {
        await using var sp = Services();
        var client = sp.GetRequiredService<IClikgateClient>();
        Assert.Equal("test", client.Mode);
        Assert.Same(client, sp.GetRequiredService<IClikgateClient>());
        foreach (var hosted in sp.GetServices<IHostedService>())
        {
            await hosted.StopAsync(default);
        }
    }

    [Fact]
    public async Task UseClikgateClickId_captures_and_persists_from_the_query()
    {
        await using var sp = Services();
        var app = new ApplicationBuilder(sp);
        string? seen = null;
        app.UseClikgateClickId();
        app.Run(ctx =>
        {
            seen = ctx.GetClikgateClickId();
            return ctx.Response.StartAsync();
        });
        var pipeline = app.Build();
        var ctx = new DefaultHttpContext { RequestServices = sp };
        ctx.Request.Scheme = "https";
        ctx.Request.Path = "/landing";
        ctx.Request.QueryString = new QueryString("?cgid=" + Cid);
        ctx.Response.Body = new System.IO.MemoryStream();
        var feature = new ResponseFeature();
        ctx.Features.Set<Microsoft.AspNetCore.Http.Features.IHttpResponseFeature>(feature);
        await pipeline(ctx);
        Assert.Equal(Cid, seen);
        await feature.FireOnStartingAsync();
        Assert.Equal(["_cg_cgid=" + Cid + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure", "_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure"], ctx.Response.Headers.SetCookie.ToArray());

        var again = new DefaultHttpContext { RequestServices = sp };
        again.Request.Headers.Cookie = "_cg_cgid=" + Cid;
        Assert.Equal(Cid, again.GetClikgateClickId());
    }

    private sealed class ResponseFeature : Microsoft.AspNetCore.Http.Features.HttpResponseFeature
    {
        private readonly List<(System.Func<object, Task> Callback, object State)> _starting = [];

        public override void OnStarting(System.Func<object, Task> callback, object state) => _starting.Add((callback, state));

        public async Task FireOnStartingAsync()
        {
            foreach (var (cb, state) in _starting)
            {
                await cb(state);
            }
        }
    }
}
#endif
