# Clikgate (.NET)

The official Clikgate server SDK for .NET. It:

- sends goals in three lines;
- keeps the click ID;
- verifies webhooks;
- has private mode built in.

Targets: `netstandard2.0` (.NET Framework 4.6.2+, for banks still on it), `net8.0` and `net10.0`. It has no dependencies on .NET 8+, and only `System.Text.Json` on .NET Standard 2.0. It is async-first, with nullable reference types.

```bash
dotnet add package Clikgate
dotnet add package Clikgate.AspNetCore     # ASP.NET Core: AddClikgate(), UseClikgateClickId()
```

```csharp
using Clikgate;

var clikgate = new ClikgateClient();                       // reads CLIKGATE_API_KEY (cg_live_… or cg_test_…)
clikgate.Goal("account_opened", new GoalOptions { ClickId = clickId, Reference = "APP-55231", Value = 2_000_000m });
```

Create one client and reuse it. It is thread-safe.

- **`Goal()`** never throws. It queues the event, and a background worker sends it in batches with safe retries.
- **`GoalAsync()`** sends at once and awaits, and still never throws.
- **`Goals.SendAsync()`** awaits the API and returns the `GoalEvent`: `Status` is `GoalStatus.COUNTED`, `WAITING`, `RECEIVED` or `REFUSED` (with `Reason`), plus `GoalKind` (`GoalKind.STANDARD` or `GoalKind.PAYMENT`), `EventStatus`, `AttributedTo`, …. `received` means the name isn't ticked as a goal in the dashboard yet (or the goal is archived): it is stored, not counted, and shows in "Seen from your app and website". Every status is a result, never an error, and none is retried. Goals work on every plan, up to the plan's allowance.

`Goal()` is the only goal method: there is no separate payment method. The goal's kind (Standard or Payment) is set in the goal's settings in the dashboard, never in the call.


### Match by hashed email or phone (ad networks)

If the business has turned on matching by hashed email or phone for an ad network destination, a goal can carry the customer's email and phone as SHA-256 hashes. `HashForAds.Hash(email, phone)` normalises and hashes them on your server (pure and offline; either argument may be null): the email is trimmed and lowercased, and the phone must include its country code (`+234 803 123 4567` or `00234…`; a national number such as `0803 123 4567` is refused with `invalid_argument`). Pass the result with `.WithHashed(…)`, or set `HashedEmail`, `HashedPhoneE164` and `HashedPhoneDigits` yourself (64 lowercase hex characters, else a local `invalid_hashed_identifier`).

```csharp
clikgate.Goal("account_opened", new GoalOptions { ClickId = clickId, Reference = "APP-55231" }
    .WithHashed(HashForAds.Hash(customer.Email, customer.Phone)));
```

In private mode, hash on your own server: Clikgate never hashes for you there. The hashes are never written to the SDK's logs or `OnError` context.

## Identify your users

Two ways to tell Clikgate which of your users is using the app. Full guide: https://clikgate.com/docs/identify-users. The customer ID is your own user ID from your database, never an email, phone number or ID number. Anonymous users don't need either path.

**Path A (default): identity token.** Create the identity secret in Apps › your app › Identity secret and store it as `CLIKGATE_IDENTITY_SECRET` on your server only. `IdentityTokens.Create(customerId, appId)` (also `clikgate.CreateIdentityToken()`, with `ClikgateOptions.IdentitySecret` / `IdentitySecrets`; ASP.NET Core: `Clikgate:IdentitySecret`, `Clikgate:IdentitySecrets:<appId>`) signs a token with no network call; return it in the responses the app already calls, and the app passes it to the mobile SDK's `identifyUser()`. Tokens last 30 days by default and are never force-refreshed. Throws `ClikgateServerOnlyException` under MAUI or Xamarin and in browser (WebAssembly) builds.

```csharp
// sign-in and "current user" responses: one extra field
return Results.Ok(new { user, clikgateIdentityToken = IdentityTokens.Create(user.Id) });   // reads CLIKGATE_IDENTITY_SECRET
IdentityTokens.Create(user.Id, appId: "app_…");                                            // several apps: CLIKGATE_IDENTITY_SECRETS
```

**Path B: installation ID, no secret or token.** The app reads `getInstallationId()` and includes it in its sign-in request; your server calls `identifyUser` with the app ID, installation ID and customer ID, after sign-in and at every signed-in app open. Clikgate accepts installations active in the last 7 days.

```csharp
// The app sends Clikgate.getInstallationId() with its sign-in request (null when tracking is off: skip)
if (installationId is not null)
    await clikgate.IdentifyUserAsync(new IdentifyUserParams { AppId = "app_…", InstallationId = installationId, CustomerId = user.Id });
```

## People: identify a user and label them

Link a click, an app installation or your customer ID to a person, and give them a label your team sees instead of the click ID (1-80 characters; Growth and up). From your server this is always verified. Goals take the same `label`, and `isFirst` from your server is what counts a new customer. Don't put information in labels that your customers wouldn't expect you to keep.

```csharp
await clikgate.IdentifyUserAsync(new IdentifyUserParams { ClickId = order.ClickId, CustomerId = "user_42", Label = "Ada (VIP)" });
clikgate.Goal("account_opened", new GoalOptions { ClickId = clickId, Reference = "APP-55231", IsFirst = true, Label = "Ada (VIP)" });
```

## ASP.NET Core

```csharp
builder.Services.AddClikgate();           // binds the "Clikgate" configuration section
var app = builder.Build();
app.UseClikgateClickId();

app.MapPost("/applications", (HttpContext ctx) => Save(ctx.GetClikgateClickId()));
app.MapPost("/applications/{id}/approve", (string id, IClikgateClient clikgate) =>
    clikgate.Goal("account_opened", new GoalOptions { Reference = id, Value = 2_000_000m }));
```

`appsettings.json`:

```json
{ "Clikgate": { "ApiKey": "cg_live_…", "SendMode": "Background", "PrivateMode": "auto", "Timeout": "00:00:10" } }
```

- `AddClikgate(o => …)` overrides settings in code.
- The client is an `IClikgateClient` singleton. It logs through `ILogger` (category `Clikgate`, with the warning code as the `EventId` name).
- An `IHostedService` flushes queued goals in `StopAsync`.
- The full example is in `examples/MinimalApi`.

## Keep the click ID

The pattern is: capture it on landing, save it with your own record, then send the goal later from any job.

- **ASP.NET Core:** `UseClikgateClickId()` and `HttpContext.GetClikgateClickId()`. The middleware keeps a `?cgid=…` in the first-party `_cg_cgid` cookie, which the web script also reads.
- **Elsewhere:**
  - `clikgate.ClickIds.FromRequest(url, name => headers[name])`
  - `clikgate.ClickIds.Persist((n, v) => response.AddHeader(n, v), clickId)`
  - `clikgate.ClickIds.FromPaymentMetadata(json)` for Paystack, Flutterwave, Shopify and WooCommerce payloads.

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

1. **Persist it from the query** when a visitor lands with `?cgid=…`: `UseClikgateClickId()` does it (also `Persist()` by hand), and adds the `_cg_kept=s` marker so goals report `kept_by: server_cookie`.
2. **The `/cg/keep` route**, for pages your server doesn't render itself (a static or cached landing page): add `data-server-endpoint="/cg/keep"` to the web script, and it posts the click ID from the page URL to that route once.

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
- **Elsewhere:** `clikgate.ClickIds.KeepRoute(options).Respond(method, header, body)` returns a `KeepResponse` (status and headers to send); read at most `ClikgateKeepRoute.MaxBody + 1` bytes of the body.
- **Visitor context for goals:** `HttpContext.GetClikgateContext()` (or `clikgate.ClickIds.Context(url, header)`) returns a `ClickContext` with `ClickId`, `KeptBy` (`server_cookie`, `script_cookie`, `form` or null), `BrowserEngine` and `Platform`. The SDK reads the `User-Agent` to work these out; the User-Agent itself is never sent. Use `new GoalOptions { Reference = "APP-55231" }.WithContext(ctx.GetClikgateContext())`, or set `KeptBy`, `BrowserEngine` and `Platform` yourself. These three fields are allowed in private mode.

## Money

- `Value` is in **normal units** (₦2,000,000 is `2_000_000m`, never kobo) and is always sent as a decimal string.
- It accepts a `decimal` (with its scale kept), a `long`/`int`, or a decimal `string`.
- There are no `double` or `float` conversions.

## Webhooks

```csharp
var ev = Webhooks.Verify(rawBodyBytes, request.Headers["Clikgate-Signature"], secret);
```

- Pass the **raw** body bytes.
- Deliveries are at-least-once: dedupe on `ev.Id`.
- Use `Webhooks.VerifyAny(body, header, [newSecret, oldSecret])` while you rotate your own secrets.

## Private mode

- With `PrivateMode.Auto` (the default), the SDK reads your organisation's setting from `GET /v1/server-sdk/config` and caches it for 10 minutes.
- When private mode is on, only `goal`, `ClickId`, `Code`, `Reference`, `Value`, `Currency`, `Provider`, `IsFirst`, `OccurredAt` and `Consent` are sent. Anything else (`Metadata`, emails, customer IDs, …) is refused **before sending** with `PrivateModeFieldRejectedException`, which names the field, never its value.
- References are redacted in logs. If the setting can't be loaded, the SDK assumes private mode is on.

## Payment goals

A **Payment goal** counts only when a trusted source confirms the payment, with the confirmed amount:

- Your **website or app** reports it with `goal()` and the payment's `provider` and `reference` (never an amount);
  the result is `WAITING` until it is confirmed.
- Your **server** confirms it **right after its own verification with the gateway**: send the same Payment goal with
  `Goals.SendAsync()` and the confirmed value, or pass the gateway's verified response to a helper below.

```csharp
var ev = await clikgate.Goals.SendAsync("order_paid", new GoalOptions
{
    Reference = "T123456", Provider = Provider.PAYSTACK, Value = 7500m, Currency = "NGN", ClickId = clickId,
});
if (ev.Status == GoalStatus.WAITING) { /* counted once the website's or app's report arrives */ }
```

Never send data from the browser or the app this way, and never give Clikgate a gateway secret key. `Provider` has a
constant for every gateway (`Provider.PAYSTACK`, `Provider.MTN_MOMO`, …); `Provider.FromString("…")` or a plain string
names a gateway added after your SDK release (the API checks it). Payment goals and confirmations need Starter or
above: on Free the API answers `403 plan_feature_unavailable` (`PermissionException`, `RequiredPlan` is `starter`).

`Provider` and `Reference` are required on a Payment goal (`422 payment_goal_needs_confirmation`, with `missing`); the SDK can't check it, because the kind lives only in the goal's settings. `Conversions.CreateAsync(...)` on a Payment goal is the same confirmation and answers the goal event: check `IsGoalEvent` and read `AsGoalEvent()`.

```csharp
// after your own GET https://api.paystack.co/transaction/verify/{reference} returned successfully
await clikgate.Payments.FromPaystackAsync(verifyResponseJson);   // JsonElement or the raw JSON text

await clikgate.Payments.FromFlutterwaveAsync(verifyJson);        // GET /v3/transactions/{id}/verify
await clikgate.Payments.FromMonnifyAsync(statusJson);            // GET /api/v2/transactions/{transactionReference}
await clikgate.Payments.FromStripeAsync(paymentIntent.ToJson()); // a PaymentIntent or Checkout Session you retrieved or verified

// any other gateway, or a refund:
await clikgate.Payments.ConfirmAsync(new PaymentConfirmParams
{
    Provider = Provider.PAYSTACK, Reference = reference, Status = "refunded", Amount = 2500m, Currency = "NGN",
});
```

- The helpers read only the reference, status, amount, currency and time, plus the test flag and `cg_click_id`.
  They never read customer details. Amounts stay exact: they are read from the JSON text, never through `double`.
- A helper returns null and sends nothing when the response has no reference or an unknown status. Use
  `PaymentHelpers.BuildFromPaystack(...)` to see the body without sending it.
- Pass `new PaymentHelperOptions { Goal = "order_paid", ClickId = clickId }` to choose the goal or the click.
- Private mode allows every confirmation field. Anything extra is refused before it is sent.

## Links and the rest of the API

```csharp
var link = await clikgate.Links.CreateAsync(new Dictionary<string, object?> { ["destination_url"] = "https://example.com/spring" });
var r = await clikgate.Links.UpdateAsync(link.Id!, new Dictionary<string, object?> { ["destination_url"] = "https://example.com/summer" });
if (!r.Applied) Console.WriteLine("waiting for a second person: " + r.ChangeRequest!.Id);
await foreach (var l in clikgate.Links.ListAsync()) Console.WriteLine(l.ShortUrl);
// Filter by your own link metadata (sent as metadata[seller_id]=sel_ada); analytics take it too.
var bySeller = new Dictionary<string, object?> { ["metadata"] = new Dictionary<string, string> { ["seller_id"] = "sel_ada" } };
await foreach (var l in clikgate.Links.ListAsync(bySeller)) Console.WriteLine(l.Metadata["seller_id"]);
```

- A locked link throws `LinkLockedException`.
- `clikgate.Api.<Resource>.<Operation>Async(…)` exposes every other API-key operation ("advanced"), generated from the OpenAPI document. It returns `JsonNode`, and is sent through the same pipeline.

## Errors and options

- **Errors.** Every exception extends `ClikgateException`, with `Code`, `HttpStatus`, `RequestId`, `Param`, `Type` and `Raw`. The classes are:
  - `ConfigurationException`, `AuthenticationException`, `PermissionException`;
  - `InvalidRequestException` and `PrivateModeFieldRejectedException`;
  - `NotFoundException`, `ConflictException`, `LinkLockedException`, `IdempotencyException`;
  - `RateLimitException` (`RetryAfter`), `ServerException`;
  - `ClikgateNetworkException`, `ClikgateTimeoutException`;
  - `SignatureVerificationException`.
- **Retries.** Network errors, timeouts and HTTP 429, 500, 502, 503 and 504 are retried with full-jitter backoff, honouring `Retry-After`.
- **Options** (`ClikgateOptions`):
  - `ApiKey`, `BaseUrl`, `Timeout`, `MaxRetries`, `SendMode`, `PrivateMode`, `ClickIdParam`;
  - `Logger` (an `IClikgateLogger`; the default is `Trace`), `OnError`;
  - `HttpClient`: bring your own, e.g. from `IHttpClientFactory`, with mTLS. Turn off `AllowAutoRedirect`;
  - `Proxy`, `NoProxy`, `BatchSize`, `FlushInterval`, `MaxQueueSize`, `ShutdownHooks`;
  - `Clock` and `Random`, for tests.

Licence: MIT. Security: see [SECURITY.md](SECURITY.md).
