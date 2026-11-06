using System;
using System.Collections.Concurrent;
using System.IO;
using Clikgate;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddClikgate(); // the "Clikgate" section (Clikgate:ApiKey, …) or CLIKGATE_API_KEY; one client, reused
var app = builder.Build();

// 1. Capture: keeps ?cgid=… in the first-party cookie (with the _cg_kept=s marker) and exposes HttpContext.GetClikgateClickId()
app.UseClikgateClickId(new Clikgate.AspNetCore.ClickIdMiddlewareOptions { Days = 90 });

// 1b. Keep the click ID longer in Safari: the web script (data-server-endpoint="/cg/keep") posts it here, on the same
// host as the website, and the server sets the cookie (204, empty, never a redirect)
app.MapClikgateKeep("/cg/keep", new Clikgate.CookieOptions { Days = 90 });

var applications = new ConcurrentDictionary<string, ClickContext>(); // your database in real life

// 2. Save the click ID with your own record, and how it was kept (the User-Agent is read here, never sent)
app.MapPost("/applications", (HttpContext ctx) =>
{
    var id = "APP-" + (55231 + applications.Count);
    applications[id] = ctx.GetClikgateContext();
    return Results.Created("/applications/" + id, new { id });
});

// 3. Later, from any job: send the goal (background, never throws, retried safely)
app.MapPost("/applications/{id}/approve", (string id, IClikgateClient clikgate) =>
{
    if (!applications.TryGetValue(id, out var context))
    {
        return Results.NotFound();
    }
    clikgate.Goal("account_opened", new GoalOptions { Reference = id, Value = 2_000_000m, Currency = "NGN" }.WithContext(context));
    return Results.Ok(new { approved = true });
});

// 4. Verify Clikgate webhooks over the raw bytes
app.MapPost("/webhooks/clikgate", async (HttpRequest request) =>
{
    using var body = new MemoryStream();
    await request.Body.CopyToAsync(body);
    try
    {
        var ev = Webhooks.Verify(body.ToArray(), request.Headers["Clikgate-Signature"], Environment.GetEnvironmentVariable("CLIKGATE_WEBHOOK_SECRET") ?? string.Empty);
        if (ev.Type == "goal.completed")
        {
            Console.WriteLine("goal completed " + ev.Id); // dedupe on ev.Id: delivery is at-least-once
        }
        return Results.Ok();
    }
    catch (SignatureVerificationException e)
    {
        return Results.BadRequest(e.Code);
    }
});

app.Run();
