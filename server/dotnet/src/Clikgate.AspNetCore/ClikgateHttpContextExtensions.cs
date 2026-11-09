using Clikgate;
using Clikgate.AspNetCore;
using Microsoft.Extensions.DependencyInjection;

namespace Microsoft.AspNetCore.Http;

/// <summary><c>HttpContext</c> helpers.</summary>
public static class ClikgateHttpContextExtensions
{
    /// <summary>The click ID found by <c>UseClikgateClickId()</c>, or null. Without the middleware it reads the request directly.</summary>
    /// <example><code>app.MapPost("/applications", (HttpContext ctx) => Save(ctx.GetClikgateClickId()));</code></example>
    public static string? GetClikgateClickId(this HttpContext context)
    {
        if (context.Items.TryGetValue(ClikgateClickIdMiddleware.ItemKey, out var v))
        {
            return v as string;
        }
        var helpers = context.RequestServices.GetService<IClikgateClient>()?.ClickIds ?? new ClickIds();
        return helpers.FromRequest(context.Request.Path + context.Request.QueryString, name => context.Request.Headers.TryGetValue(name, out var h) ? h.ToString() : null);
    }

    /// <summary>
    /// The visitor context for a goal: the click ID, how it was kept (<c>server_cookie</c>, <c>script_cookie</c>,
    /// <c>form</c>) and the browser engine and platform, parsed from the <c>User-Agent</c> in the SDK (never sent).
    /// </summary>
    /// <example><code>clikgate.Goal("account_opened", new GoalOptions { Reference = "APP-55231" }.WithContext(ctx.GetClikgateContext()));</code></example>
    public static ClickContext GetClikgateContext(this HttpContext context)
    {
        var helpers = context.RequestServices.GetService<IClikgateClient>()?.ClickIds ?? new ClickIds();
        return helpers.Context(context.Request.Path + context.Request.QueryString, name => context.Request.Headers.TryGetValue(name, out var h) ? h.ToString() : null);
    }
}
