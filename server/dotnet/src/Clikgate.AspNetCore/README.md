# Clikgate.AspNetCore

ASP.NET Core (.NET 8 and 10) integration for the [`Clikgate`](https://www.nuget.org/packages/Clikgate) SDK.

```bash
dotnet add package Clikgate.AspNetCore
```

```csharp
builder.Services.AddClikgate();          // the "Clikgate" section (Clikgate:ApiKey, …) or CLIKGATE_API_KEY
var app = builder.Build();
app.UseClikgateClickId();                // keeps ?cgid=… in the first-party _cg_cgid cookie

app.MapPost("/applications", (HttpContext ctx) => Save(ctx.GetClikgateClickId()));
app.MapPost("/applications/{id}/approve", (string id, IClikgateClient clikgate) =>
{
    clikgate.Goal("account_opened", new GoalOptions { Reference = id, Value = 2_000_000m });
    return Results.Ok();
});
```

- `IClikgateClient` is a singleton.
- It logs through `ILogger` (category `Clikgate`).
- Queued goals are flushed when the host stops.
- `app.MapClikgateKeep("/cg/keep")` maps the `/cg/keep` route (below).

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

```csharp
builder.Services.AddClikgate();
var app = builder.Build();
app.UseClikgateClickId(new ClickIdMiddlewareOptions { Days = 90 });   // persists ?cgid=… on every page, with _cg_kept=s
app.MapClikgateKeep("/cg/keep", new Clikgate.CookieOptions { Days = 90 }); // POST /cg/keep for the web script
```

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_test_…" data-server-endpoint="/cg/keep" async></script>
```

- **Same server only.** The route must be served by the same host as the website (same scheme, host and port), because the cookie is first-party. It accepts only a same-origin `POST` (`Sec-Fetch-Site: same-origin`, else an `Origin` equal to the host), a JSON body of at most 1 KB with the same valid click ID in `click_id` and `page_click_id`, and answers `204` with `Cache-Control: no-store, private` (`400`, `403` or `405` otherwise, always empty). It never redirects and never echoes or logs what it receives.
- **Antiforgery:** ASP.NET Core's antiforgery checks don't apply here: they cover form posts, and this minimal-API endpoint reads a JSON body itself and checks the origin. Nothing to switch off.
- **The cookie name comes from your configuration** (`ClickIdParam`, else `cgid`), never from the request. `Days` is 1 to 400 (default 30; anything else throws `InvalidRequestException` `invalid_argument` at startup); `Secure` is on unless you set `Secure = false`.
- **The cookie is readable by the page on purpose** (not `HttpOnly`): the web script needs to read it. It only holds the click ID.
- **Visitor context for goals:** `HttpContext.GetClikgateContext()` (or `clikgate.ClickIds.Context(url, header)`) returns a `ClickContext` with `ClickId`, `KeptBy` (`server_cookie`, `script_cookie`, `form` or null), `BrowserEngine` and `Platform`. The SDK reads the `User-Agent` to work these out; the User-Agent itself is never sent. Use `new GoalOptions { Reference = "APP-55231" }.WithContext(ctx.GetClikgateContext())`, or set `KeptBy`, `BrowserEngine` and `Platform` yourself. These three fields are allowed in private mode.

See the [Clikgate .NET README](https://github.com/clikgate/clikgate-sdks/tree/main/server/dotnet). Licence: MIT.
