using Clikgate;
using Clikgate.AspNetCore;
using Microsoft.AspNetCore.Http;

namespace Microsoft.AspNetCore.Builder;

/// <summary>Adds the click-ID middleware.</summary>
public static class ClikgateApplicationBuilderExtensions
{
    /// <summary>
    /// Reads the click ID on every request (query <c>cgid</c>, the <c>_cg_cgid</c> cookie, or the <c>Clikgate-Click-Id</c>
    /// header), exposes it as <c>HttpContext.GetClikgateClickId()</c>, and keeps one that arrives in the query string in the
    /// first-party cookie (last click wins, like the web script).
    /// </summary>
    /// <example><code>app.UseClikgateClickId();</code></example>
    public static IApplicationBuilder UseClikgateClickId(this IApplicationBuilder app, ClickIdMiddlewareOptions? options = null) =>
        app.UseMiddleware<ClikgateClickIdMiddleware>(options ?? new ClickIdMiddlewareOptions());
}
