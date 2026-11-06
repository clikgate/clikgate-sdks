using System;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Clikgate.AspNetCore;

/// <summary>Options of <c>UseClikgateClickId()</c>.</summary>
public sealed class ClickIdMiddlewareOptions
{
    /// <summary>Write the cookie when the click ID arrives in the query string (default true).</summary>
    public bool Persist { get; set; } = true;

    /// <summary>Cookie lifetime in days (default 30).</summary>
    public double Days { get; set; } = 30;

    /// <summary>Cookie domain, e.g. <c>.example.com</c>.</summary>
    public string? Domain { get; set; }
}

/// <summary>Reads, exposes and persists the click ID (SPEC section 17).</summary>
internal sealed class ClikgateClickIdMiddleware(RequestDelegate next, ClickIdMiddlewareOptions options)
{
    internal const string ItemKey = "clikgate.click_id";

    public async Task InvokeAsync(HttpContext context)
    {
        var helpers = context.RequestServices.GetService<IClikgateClient>()?.ClickIds ?? new ClickIds();
        var url = context.Request.Path + context.Request.QueryString;
        var clickId = helpers.FromRequest(url, name => context.Request.Headers.TryGetValue(name, out var v) ? v.ToString() : null);
        context.Items[ItemKey] = clickId;
        if (clickId is not null && options.Persist && helpers.FromQuery(url) == clickId)
        {
            var secure = context.Request.IsHttps
                || string.Equals(context.Request.Headers["X-Forwarded-Proto"].ToString().Split(',')[0].Trim(), "https", StringComparison.OrdinalIgnoreCase);
            var cookieOptions = new CookieOptions { Days = options.Days, Domain = options.Domain, Secure = secure };
            var cookie = helpers.CookieHeader(clickId, cookieOptions);
            var marker = helpers.MarkerHeader(cookieOptions); // _cg_kept=s: goals then report kept_by: server_cookie
            context.Response.OnStarting(() =>
            {
                context.Response.Headers.Append("Set-Cookie", cookie);
                context.Response.Headers.Append("Set-Cookie", marker);
                return Task.CompletedTask;
            });
        }
        await next(context).ConfigureAwait(false);
    }
}

