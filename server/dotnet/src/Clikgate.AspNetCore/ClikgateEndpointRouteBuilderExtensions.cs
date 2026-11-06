using System;
using System.IO;
using System.Threading.Tasks;
using Clikgate;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace Microsoft.AspNetCore.Builder;

/// <summary>Maps the <c>/cg/keep</c> route (SPEC 13.1, change 16).</summary>
public static class ClikgateEndpointRouteBuilderExtensions
{
    /// <summary>
    /// Maps the <c>/cg/keep</c> route for the web script's <c>data-server-endpoint="/cg/keep"</c>: it sets the
    /// <c>_cg_&lt;param&gt;</c> cookie and the <c>_cg_kept=s</c> marker from your server, so Safari (and every browser on
    /// iPhone) keeps the click ID as long as you choose, up to the browser's limit, instead of up to 7 days.
    /// </summary>
    /// <remarks>
    /// Every method is mapped so the route answers <c>405</c> itself (with <c>Allow: POST</c>). Same-origin <c>POST</c>
    /// only (<c>Sec-Fetch-Site</c>, else <c>Origin</c> = host); a JSON body of at most 1 KB; <c>204</c>, always empty with
    /// <c>Cache-Control: no-store, private</c>; never a redirect, nothing echoed or logged. Antiforgery does not apply: the
    /// route reads a JSON body itself (not a form), and it checks the origin. Uses the click-ID parameter of the
    /// registered <c>IClikgateClient</c> (else <c>cgid</c>). Serve it on the same host as the website.
    /// </remarks>
    /// <param name="endpoints">The app.</param>
    /// <param name="pattern">The route (default <c>/cg/keep</c>).</param>
    /// <param name="options"><c>Days</c> (1 to 400, default 30), <c>Secure</c> (default true) and <c>Domain</c>.</param>
    /// <exception cref="InvalidRequestException"><c>invalid_argument</c> for days outside 1-400.</exception>
    /// <example><code>app.MapClikgateKeep("/cg/keep", new Clikgate.CookieOptions { Days = 90 });</code></example>
    public static IEndpointConventionBuilder MapClikgateKeep(this IEndpointRouteBuilder endpoints, string pattern = "/cg/keep", Clikgate.CookieOptions? options = null)
    {
        var helpers = endpoints.ServiceProvider.GetService<IClikgateClient>()?.ClickIds ?? new ClickIds();
        var route = helpers.KeepRoute(options);
        return endpoints.Map(pattern, CreateClikgateKeepHandler(route)).WithDisplayName("Clikgate /cg/keep");
    }

    /// <summary>The <c>/cg/keep</c> handler as a <see cref="RequestDelegate"/>, for <c>app.Map(…)</c> or your own pipeline.</summary>
    public static RequestDelegate CreateClikgateKeepHandler(ClikgateKeepRoute route) => async context =>
    {
        var request = context.Request;
        var body = HttpMethods.IsPost(request.Method) ? await ReadAsync(request.Body).ConfigureAwait(false) : [];
        var output = route.Respond(request.Method, name => request.Headers.TryGetValue(name, out var v) && v.Count > 0 ? v[0] : null, body);
        var response = context.Response;
        response.StatusCode = output.Status;
        foreach (var h in output.Headers)
        {
            response.Headers.Append(h.Key, h.Value);
        }
        if (output.Status != StatusCodes.Status204NoContent)
        {
            response.ContentLength = 0;
        }
    };

    /// <summary>At most <c>MaxBody + 1</c> bytes: enough to refuse anything larger without reading it all.</summary>
    private static async Task<byte[]> ReadAsync(Stream body)
    {
        var buffer = new byte[ClikgateKeepRoute.MaxBody + 1];
        var total = 0;
        int n;
        while (total < buffer.Length && (n = await body.ReadAsync(buffer.AsMemory(total, buffer.Length - total)).ConfigureAwait(false)) > 0)
        {
            total += n;
        }
        return buffer.AsSpan(0, total).ToArray();
    }
}
