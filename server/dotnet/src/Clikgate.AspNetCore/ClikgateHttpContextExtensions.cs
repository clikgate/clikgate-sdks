using System;
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
    /// The app's <c>Clikgate-Installation</c> header as an <see cref="Installation"/>, or null when it is missing,
    /// invalid or sent more than once. Never throws. Use it with <c>IdentifyUserAsync</c> after your own sign-in check;
    /// the customer ID always comes from your signed-in user, never from the request.
    /// </summary>
    /// <example><code>
    /// var installation = ctx.GetClikgateInstallation();
    /// if (installation is not null) await clikgate.IdentifyUserAsync(IdentifyUserParams.For(installation, user.Id));
    /// </code></example>
    public static Installation? GetClikgateInstallation(this HttpContext context)
    {
        try
        {
            if (!context.Request.Headers.TryGetValue(Installation.Header, out var values) || values.Count != 1)
            {
                return null;
            }
            return Installation.ParseHeader(values[0]);
        }
        catch (Exception)
        {
            return null;
        }
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
