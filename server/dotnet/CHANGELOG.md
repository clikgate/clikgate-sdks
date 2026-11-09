# Changelog: Clikgate and Clikgate.AspNetCore (.NET)

All notable changes to these packages, which are released together. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the packages use [semantic versioning](https://semver.org/). Deprecations are announced at least 6 months ahead, and .NET versions are dropped only after their end of support.


## [Unreleased]

### Strict goal names
- With the organisation's "Allow unknown goal names" off, the API refuses a goal name that isn't set up with `422 unknown_goal`, and an archived goal with `422 goal_archived`. Both are `InvalidRequestError` (`Code` is the reason) and final: never retried, never re-queued; background `goal()` passes them to `onError` as dropped. The SDK never checks names itself and never remembers the refusal.
- A `422` answered with the refusal body `{"status": "refused", "reason": ...}` (no error envelope) now maps to that reason instead of `http_422`; the body is the error's raw object.
- With debug logging on (`ClikgateLogLevel.Debug`), each refusal logs "Goal `{name}` isn't set up in Clikgate" with the goal name only.

### Identity tokens, one goal() method

- **Added:** `IdentityTokens.Create(customerId, appId = null)` and `IdentityTokens.Create(customerId, secret, issuedAtSeconds)` (no API key needed), and `client.CreateIdentityToken(customerId, appId = null)` (also on `IClikgateClient`, which now has `IdentifyUserAsync` too): `base64url_nopad(HMAC_SHA256(secret, customerId + "." + issuedAt)) + "." + issuedAt`, the signer Clikgate verifies with, with no network call. The secret comes from (with `appId`) that app's entry in `ClikgateOptions.IdentitySecrets` / `CLIKGATE_IDENTITY_SECRETS` (a JSON object), else `ClikgateOptions.IdentitySecret` / `CLIKGATE_IDENTITY_SECRET`; ASP.NET Core binds `Clikgate:IdentitySecret` and `Clikgate:IdentitySecrets:<appId>`. Errors: `ConfigurationException` (`missing_identity_secret`, `invalid_identity_secrets`), `InvalidRequestException` (`invalid_customer_id`: 1-255 code points; never echoed), and the new `ClikgateServerOnlyException` (`server_only`) under MAUI or Xamarin (Android, iOS, Mac Catalyst, tvOS, or their assemblies loaded) and in browser (WebAssembly) builds. Tested against the shared vectors in `server/conformance/vectors/identity-token-vectors.json`. Guide: https://clikgate.com/docs/identify-users.
- **Docs:** `IdentifyUserAsync()` documents path B (no secret or token): your server calls it with `AppId`, `InstallationId`, `CustomerId` and optionally `Label` from the installation ID the app sends at sign-in and at every signed-in app open, and skips the call when there is none.
- **Added:** `GoalStatus.RECEIVED` `received`: `goal()` / `goals.send` with a name that isn't ticked as a goal yet (or an archived goal) answers `200` with `status: "received"` and `reason` `not_counted_yet` (or `goal_archived`). It is a result, like `waiting` and `refused`: never an error and never retried.
- **Removed (generated API):** the app events resource (`clikgate.Api.AppEvents` and `AppEventsApi`): List App Events (`GET /v1/app-events`), Report App Events (`POST /v1/apps/{app_id}/events`) and the Event rules operations (`/v1/apps/{app_id}/event-rules`). Clikgate has one method for anything that happens in an app, website or server, `goal()`; names not ticked as goals yet show in the dashboard's "Seen from your app and website". No released version ever had them (the generator drops them through `server/codegen/removed.mjs` until the backend's public document no longer lists them).

### Hashed email and phone for ad networks

- **Added:** `HashForAds.Hash(string? email, string? phone)` returning `HashedIdentifiers` (`HashedEmail`, `HashedPhoneE164`, `HashedPhoneDigits`; null for an input not given). Pure and offline: the email is trimmed and lowercased and must contain `@`; the phone must start with `+` or `00` and have 7-15 digits after it. Otherwise `InvalidRequestException` `invalid_argument` (`Param` `email` or `phone`), never echoing the input.
- **Added:** `GoalOptions.HashedEmail`, `HashedPhoneE164`, `HashedPhoneDigits` and `WithHashed(HashedIdentifiers)` (wire `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`) for `Goal()`, `Goals.SendAsync` and batch events. A value that isn't 64 lowercase hex characters is refused locally (`invalid_hashed_identifier`, `Param` = the wire field); `Conversions.CreateAsync` checks the same fields in its parameters. The private-mode guard allows the three fields on goals and conversions. In private mode, hash on your own server: Clikgate never hashes for you there.
- Conformance op `hash_for_ads`.

### Keeping the click ID (change 16)

- **Added:** `app.MapClikgateKeep("/cg/keep", new Clikgate.CookieOptions { Days = 30 })` in `Clikgate.AspNetCore`: the `/cg/keep` route for the web script's `data-server-endpoint="/cg/keep"` (also `ClikgateEndpointRouteBuilderExtensions.CreateClikgateKeepHandler(route)` as a `RequestDelegate`). Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less); when your server saves it, it lasts as long as you choose, up to the browser's limit. Core: `clikgate.ClickIds.KeepRoute(CookieOptions?)` returns a `ClikgateKeepRoute` whose `Respond(method, header, body)` gives a `KeepResponse`. Same-origin `POST` only (`Sec-Fetch-Site`, else `Origin` = host), a JSON body of at most 1 KB with matching `click_id` and `page_click_id`, `204` with `Cache-Control: no-store, private`; 400/403/405 otherwise; never a redirect, never echoed or logged. `Days` must be a whole number from 1 to 400 (`invalid_argument`). Antiforgery doesn't apply (a minimal-API JSON endpoint).
- **Added:** `clikgate.ClickIds.Context(url, header)` and `HttpContext.GetClikgateContext()` returning `ClickContext` (`ClickId`, `KeptBy`: `server_cookie`, `script_cookie`, `form` or null, `BrowserEngine`, `Platform`), parsed from the `User-Agent` in the SDK (the User-Agent is never sent). Also `ClickIds.ParseBrowserEngine()` and `ClickIds.ParsePlatform()`.
- **Added:** `GoalOptions.KeptBy`, `BrowserEngine`, `Platform` and `WithContext(ClickContext)` (wire `kept_by`, `browser_engine`, `platform`), checked against their values locally (`invalid_argument`) and allowed by the private-mode guard.
- **Changed:** `Persist()` and `UseClikgateClickId()` also add the marker cookie `_cg_kept=s` after the click-ID cookie, with the same `Path`, `Max-Age`, `Domain`, `SameSite` and `Secure`, so the web script reports `kept_by: server_cookie`. New `MarkerHeader()`.
- Conformance ops `click_ids.keep` (run through the ASP.NET Core handler on a `DefaultHttpContext`) and `click_ids.context`.

### identifyUser, goal labels, App banners

- **Added:** `await clikgate.IdentifyUserAsync(new IdentifyUserParams { … })` returning `PersonIdentified` → `POST /v1/people/identify`: at least one reference (a click, an app installation or a customer ID; with a click or installation the customer ID links it). Always verified, so it also satisfies a referral program's `require_identity_token`. Local `invalid_request` without a reference or with half an installation. In private mode the guard refuses the customer ID; `label` passes (the API needs "Allow labels in private mode", else `422 labels_off_in_private_mode`).
- **Added:** goals take `label` (the person's label, 1-80 characters; Growth and up), allowed by the private-mode guard.
- **Removed (generated API):** the app server-identify operation (`POST /v1/apps/{app_id}/identify`); use `identifyUser`. The Journeys API is now the App banners API (`AppBannersApi`, `app_banner_id`, `AppBanner*` types, type `full_screen`, webhooks `app_banner.published` / `app_banner.paused`); IDs keep the `jrn_` prefix.
- **Regenerated** from the current public OpenAPI (523 operations), including the share events, QR, referral map, single sign-on, people, customer cost).

### Breaking
- **Goal results:** `GoalEvent.Status` is now the call's outcome as `GoalStatus?` (`COUNTED`, `WAITING`, `REFUSED`;
  null for a value this version doesn't know) instead of the attribution state string, which moved to
  `GoalEvent.EventStatus`.
- **`PaymentConfirmParams.Provider`** is a `Provider?` (was `string?`). A string still converts implicitly
  (`Provider = "paystack"` compiles); `PaymentConfirmation.Provider` is a `Provider?` too.
- **Removed** `Goals.IdempotencyKey(goal, reference)` (obsolete and unused since 1.1.0: goal calls send a random
  `Idempotency-Key`).
- **Removed** the unused generated `WordPressPluginApi` class (plugin-key operations; never reachable from `Api`).
- The goal object of the generated `Api.Goals` operations has `kind` and `suggest_payment` instead of
  `confirmation`; `UpdateGoalAsync` also takes `confirm_kind_change`.

### Added
- **Private mode allows `consent`** (the four-purpose consent object) on goals, batch items and conversions, as the API does; it was refused locally before. Payment confirmations also allow the API's structural `refund_id` and `source_plugin` (through `extra`).
- Local builds use deterministic source paths (`PathMap` in `Directory.Build.props`), so a locally packed nupkg/snupkg embeds no absolute paths.
- `Conversion.IsGoalEvent` / `AsGoalEvent()` / `Object`: on a Payment goal `Conversions.CreateAsync` answers with the goal event. `Provider`, `GoalKind` and `GoalStatus` values in parameter dictionaries are sent as their wire strings. A server Payment goal needs `Provider` and `Reference` (`422 payment_goal_needs_confirmation` with `missing`; no default provider).
- **Enums** generated from the API description: `GoalKind` (`STANDARD`, `PAYMENT`) and `GoalStatus` (`COUNTED`,
  `WAITING`, `REFUSED`) with `ToWire()` and `ClikgateEnums.ParseGoalKind` / `ParseGoalStatus`, and the `Provider`
  struct (`Provider.PAYSTACK`, …, `Provider.Values`, and `Provider.FromString("…")` for a gateway added after this
  release).
- **`GoalOptions.Provider`:** the payment provider of a goal call (wire field `provider`, allowed in private mode). A
  malformed key is refused locally with `invalid_provider`. A Payment goal sent by your server is a trusted
  confirmation: send it with `Goals.SendAsync()` and the confirmed value.
- `GoalEvent.GoalKind`, `ValueIgnored`, `EventStatus` and `Payment`.
- `PermissionException.RequiredPlan` carries `starter` on `plan_feature_unavailable` (payment goals and
  confirmations need Starter or above).
- Conformance suite `compat`: unknown response fields and enum values are kept, never an error.
- **Payments confirmed by your server (SPEC section 22):** `client.Payments.ConfirmAsync(new PaymentConfirmParams { Provider, Reference, Status, Amount, … })` sends `POST /v1/payments/confirmations` and returns a `PaymentConfirmation`. The gateway helpers `FromPaystackAsync`, `FromFlutterwaveAsync`, `FromMonnifyAsync` and `FromStripeAsync` take your own verified gateway response (`JsonElement` or the raw JSON text). They read only the reference, aliases, status, amount, currency, time, test flag and `cg_click_id`, and return null when there is nothing to send (`unrecognised_payment_response` warning). Amounts are read from the raw JSON number text and sent as the shortest exact decimal, never through `double`. The pure builders are `PaymentHelpers.BuildFromPaystack(...)` (also on `client.Payments`). In private mode the guard allows only the confirmation fields, so `Extra` fields are refused before anything is sent. Call them right after your own verification, never with browser or app data.
- `IClikgateClient.Payments`. Classes that implement `IClikgateClient` themselves (test doubles) need the new property.

### Changed
- **Fraud rules and the fraud test lab (backend, 2026-10-28):** the generated API layer is regenerated (757 operations; 461 kept). New fraud rules operation (`GET /v1/fraud/rules`, `FraudRulesDetailResponse`, plans with fraud insights). `FraudSampleResponse` (`createFraudSample`) no longer has `score` or `threshold`, `reasons` is `{rule, name}[]` (`FraudSampleReason`) and `FraudSamplePlanOutcome` has no `threshold`. These are removals from a response type.

## [1.1.0] - unreleased

### Added
- **Metadata filters:** `metadata` on the typed `Api.Links.ListLinksAsync`, `Api.Analytics.AnalyticsSummaryAsync`, `AnalyticsTimeseriesAsync`, `TopLinksAsync` and `OpenInAppAnalyticsAsync` methods and on `Links.ListAsync` / `ListPageAsync`. A map such as a `Dictionary<string, string>` or `JsonObject` under the `"metadata"` key of the query dictionary is sent as `metadata[seller_id]=sel_ada` (SPEC section 21). The backend reads these from the raw query string, so the codegen adds the parameter (`codegen/filter.mjs`).
- **Webhook `subscription.updated`:** documented on the webhook event type; it carries the subscription with `add_ons`, `change` and `add_on_key`. `type` stays a plain string, so nothing else changes. Conformance `webhooks.valid.subscription_updated`.
- `Link.Metadata` (`JsonObject`, empty when none) and `Link.ExternalReference`.
- The generated `Api` layer is regenerated from the final backend `openapi.json` (756 operations; 460 kept). `end_goal_value` comes back as decimal strings per currency next to `end_goal_value_minor`.
- `GoalEvent.ValueMinor`, `ReversedValue` and `ReversedValueMinor`: the amounts in minor units (`long?`) next to the decimal strings, as the API returns them.

### Changed
- `Goals.SendAsync` and `Goal()`/`GoalAsync()` in sync mode send a random UUID v4 `Idempotency-Key` per call, reused across that call's retries, instead of `sha256(goal:reference)`. The API dedupes goal events by goal and reference itself, so a resend still never counts twice. `RequestOptions.IdempotencyKey` still overrides the key.

## [1.0.0] - unreleased (first release)

### Added
- `ClikgateClient` (`IClikgateClient`):
  - `Goal()` (background batching, never throws) and `GoalAsync()`;
  - `Goals.SendAsync`, `SendBatchAsync` and `ReverseAsync`;
  - `FlushAsync`, `CloseAsync`, `DisposeAsync`, and a flush on `ProcessExit`.
- `Conversions`, `Links` (`LinkUpdateResult`, `LinkLockedException`, `IAsyncEnumerable` listing, QR codes) and `Clicks`.
- `ClickIds` and the static `Webhooks.Verify` / `VerifyAny`.
- The private-mode guard, typed exceptions, `MoneyValue` (decimal, long and string; no floating point), retries with full jitter and `Retry-After`, and deterministic goal idempotency keys.
- `clikgate.Api`: every API-key operation, generated from openapi.json.
- `Clikgate.AspNetCore`: `AddClikgate()` (the `Clikgate` configuration section, `ILogger`, flush on host stop), `UseClikgateClickId()` and `HttpContext.GetClikgateClickId()`.
