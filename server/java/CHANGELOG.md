# Changelog: com.clikgate:clikgate-java (and the starter and Servlet filters)

All notable changes to these artifacts, which are released together. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the artifacts use [semantic versioning](https://semver.org/). Deprecations are announced at least 6 months ahead, and Java versions are dropped only after their end of life.


## [2.0.0] - unreleased

### Breaking: track() removed in favour of goal()

- **Removed:** `track()` and app events are gone from Clikgate in favour of one method, `goal()`, for anything that happens in an app, website or server. A name that isn't set up as a goal yet still arrives (status `received`) and shows in the dashboard under "Seen from your app and website", ready to be counted. In this SDK that removes the generated app events resource (details under "Identity tokens, one goal() method" below): send `goal()` instead.

### Strict goal names
- With the organisation's "Allow unknown goal names" off, the API refuses a goal name that isn't set up with `422 unknown_goal`, and an archived goal with `422 goal_archived`. Both are `InvalidRequestError` (`getCode()` is the reason) and final: never retried, never re-queued; background `goal()` passes them to `onError` as dropped. The SDK never checks names itself and never remembers the refusal.
- A `422` answered with the refusal body `{"status": "refused", "reason": ...}` (no error envelope) now maps to that reason instead of `http_422`; the body is the error's raw object.
- With debug logging on (SLF4J debug or java.util.logging `FINE`; `ClikgateLogger` gains a `debug(code, message)` default method that does nothing), each refusal logs "Goal `{name}` isn't set up in Clikgate" with the goal name only.

### Identity tokens, one goal() method

- **Added:** `IdentityTokens.create(customerId)`, `IdentityTokens.create(customerId, appId)` and `IdentityTokens.create(customerId, secret, issuedAtSeconds)` (no API key needed), and `clikgate.createIdentityToken(customerId)` / `createIdentityToken(customerId, appId)`: `base64url_nopad(HMAC_SHA256(secret, customerId + "." + issuedAt)) + "." + issuedAt`, the signer Clikgate verifies with, with no network call. The secret comes from (with `appId`) that app's entry in the builder's `identitySecrets(...)` / `CLIKGATE_IDENTITY_SECRETS` (a JSON object), else `identitySecret(...)` / `CLIKGATE_IDENTITY_SECRET`. Errors: `ConfigurationException` (`missing_identity_secret`, `invalid_identity_secrets`), `InvalidRequestException` (`invalid_customer_id`: 1-255 code points; never echoed), and the new `ClikgateServerOnlyException` (`server_only`) when `android.os.Build` loads (an Android app). Tested against the shared vectors in `server/conformance/vectors/identity-token-vectors.json`. Guide: https://clikgate.com/docs/identify-users.
- **Docs:** `identifyUser()` documents path B (no secret or token): your server calls it with `appId`, `installationId`, `customerId` and optionally `label` from the installation ID the app sends at sign-in and at every signed-in app open, and skips the call when there is none.
- **Added:** `GoalStatus.RECEIVED` `received`: `goal()` / `goals.send` with a name that isn't ticked as a goal yet (or an archived goal) answers `200` with `status: "received"` and `reason` `not_counted_yet` (or `goal_archived`). It is a result, like `waiting` and `refused`: never an error and never retried.
- **Removed (generated API):** the app events resource (`clikgate.api().appEvents()` and `AppEventsApi`): List App Events (`GET /v1/app-events`), Report App Events (`POST /v1/apps/{app_id}/events`) and the Event rules operations (`/v1/apps/{app_id}/event-rules`). Clikgate has one method for anything that happens in an app, website or server, `goal()`; names not ticked as goals yet show in the dashboard's "Seen from your app and website". No released version ever had them (the generator drops them through `server/codegen/removed.mjs` until the backend's public document no longer lists them).

### Hashed email and phone for ad networks

- **Added:** `HashForAds.hash(String email, String phone)` returning `HashedIdentifiers` (`getHashedEmail()`, `getHashedPhoneE164()`, `getHashedPhoneDigits()`; null for an input not given). Pure and offline: the email is trimmed and lowercased and must contain `@`; the phone must start with `+` or `00` and have 7-15 digits after it. Otherwise `InvalidRequestException` `invalid_argument` (param `email` or `phone`), never echoing the input.
- **Added:** `Goal.Builder.hashedEmail()`, `hashedPhoneE164()`, `hashedPhoneDigits()` and `hashed(HashedIdentifiers)` (wire `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`) for `goal()`, `goals().send()` and batch events. A value that isn't 64 lowercase hex characters is refused locally (`invalid_hashed_identifier`, param = the wire field); `conversions().create()` checks the same fields in its params. The private-mode guard allows the three fields on goals and conversions. In private mode, hash on your own server: Clikgate never hashes for you there.
- Conformance op `hash_for_ads`.

### Keeping the click ID

- **Added:** the `/cg/keep` route for the web script's `data-server-endpoint="/cg/keep"`. Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less); when your server saves it, it lasts as long as you choose, up to the browser's limit. Core: `clikgate.clickIds().keepRoute(CookieOptions)` returns a `KeepRoute` whose `respond(method, header, body)` gives a `KeepRoute.Response` (status and headers). Servlet: `ClikgateKeepServlet` in `clikgate-servlet-jakarta` and `clikgate-servlet-javax`. Spring Boot starter: `ClikgateKeepController` for `POST /cg/keep`, only with `clikgate.keep-route.enabled=true` (default false; also `clikgate.keep-route.path`, `clikgate.keep-route.secure`); with Spring Security, exclude the path from CSRF. Same-origin `POST` only (`Sec-Fetch-Site`, else `Origin` = host), a JSON body of at most 1 KB with matching `click_id` and `page_click_id`, `204` with `Cache-Control: no-store, private`; 400/403/405 otherwise; never a redirect, never echoed or logged. `days` must be a whole number from 1 to 400 (`invalid_argument`).
- **Added:** `clikgate.clickIds().context(url, header)` (and `ClikgateFilter.context(clikgate, request)`) returning `ClickContext`: the click ID, `getKeptBy()` (`server_cookie`, `script_cookie`, `form` or null), `getBrowserEngine()` and `getPlatform()`, parsed from the `User-Agent` in the SDK (the User-Agent is never sent). Also `ClickIds.browserEngine(ua)` and `ClickIds.platform(ua)`.
- **Added:** `Goal.Builder.keptBy()`, `browserEngine()`, `platform()` and `context(ClickContext)` (wire `kept_by`, `browser_engine`, `platform`), checked against their values locally (`invalid_argument`) and allowed by the private-mode guard.
- **Changed:** `persist()` (and the Servlet filters and the starter's filter) also adds the marker cookie `_cg_kept=s` after the click-ID cookie, with the same `Path`, `Max-Age`, `Domain`, `SameSite` and `Secure`, so the web script reports `kept_by: server_cookie`. New `markerHeader()`.
- Conformance ops `click_ids.keep` and `click_ids.context`.

### identifyUser, goal labels, App banners

- **Added:** `clikgate.identifyUser(IdentifyUserParams.builder()….build())` returning `PersonIdentified` → `POST /v1/people/identify`: at least one reference (a click, an app installation or a customer ID; with a click or installation the customer ID links it). Always verified, so it also satisfies a referral program's `require_identity_token`. Local `invalid_request` without a reference or with half an installation. In private mode the guard refuses the customer ID; `label` passes (the API needs "Allow labels in private mode", else `422 labels_off_in_private_mode`).
- **Added:** goals take `label` (the person's label, 1-80 characters; Growth and up), allowed by the private-mode guard.
- **Removed (generated API):** the app server-identify operation (`POST /v1/apps/{app_id}/identify`); use `identifyUser`. The Journeys API is now the App banners API (`AppBannersApi`, `app_banner_id`, `AppBanner*` types, type `full_screen`, webhooks `app_banner.published` / `app_banner.paused`); IDs keep the `jrn_` prefix.
- **Regenerated** from the current public OpenAPI (523 operations), including the share events, QR, referral map, single sign-on, people, customer cost).

### Breaking
- **Goal results:** `GoalEvent.getStatus()` now returns the call's outcome as `GoalStatus` (`COUNTED`, `WAITING`,
  `REFUSED`; null for a value this version doesn't know) instead of the attribution state string. The attribution
  state (`attributed`, `unattributed`, `rejected_bot`, …) moved to `getEventStatus()`.
- **`PaymentConfirmation.getProvider()`** returns a `Provider` (was a `String`; `getValue()` has the key).
- **Removed** `Goals.idempotencyKey(goal, reference)` (deprecated and unused since 1.1.0: goal calls send a random
  `Idempotency-Key`).
- **Removed** the unused generated `WordPressPluginApi` class (plugin-key operations; never reachable from `api()`).
- The goal object of the generated `api().goals()` operations has `kind` and `suggest_payment` instead of
  `confirmation`; `updateGoal` also takes `confirm_kind_change`.

### Added
- **Private mode allows `consent`** (the four-purpose consent object) on goals, batch items and conversions, as the API does; it was refused locally before. Payment confirmations also allow the API's structural `refund_id` and `source_plugin` (through `extra`).
- `Conversion.isGoalEvent()` / `asGoalEvent()` / `getObject()`: on a Payment goal `conversions().create` answers with the goal event. `Provider`, `GoalKind` and `GoalStatus` values in params maps are sent as their wire strings. A server Payment goal needs `provider` and `reference` (`422 payment_goal_needs_confirmation` with `missing`; no default provider).
- **Enums** generated from the API description: `GoalKind` (`STANDARD`, `PAYMENT`), `GoalStatus` (`COUNTED`,
  `WAITING`, `REFUSED`), each with `getValue()` and `fromValue(String)`, and `Provider` (`Provider.PAYSTACK`, …,
  `values()`, and `Provider.fromString("…")` for a gateway added after this release), all in `com.clikgate.model`.
- **`Goal.Builder.provider(Provider)` / `provider(String)`:** the payment provider of a goal call (wire field
  `provider`, allowed in private mode). A malformed key is refused locally with `invalid_provider`. A Payment goal
  sent by your server is a trusted confirmation: send it with `goals().send()` and the confirmed value.
- `GoalEvent.getGoalKind()`, `isValueIgnored()`, `getEventStatus()` and `getPayment()`.
- `PaymentConfirmParams.Builder.provider(Provider)`, next to `provider(String)`; the gateway helpers use the
  `Provider` constants.
- `PermissionException.getRequiredPlan()` is documented for `plan_feature_unavailable` (payment goals and
  confirmations need Starter or above).
- **Payments confirmed by your server (SPEC section 22):** `payments().confirm(PaymentConfirmParams)` (`POST /v1/payments/confirmations`), the gateway helpers `fromPaystack`, `fromFlutterwave`, `fromMonnify` and `fromStripe` (a `Map`, a Jackson `JsonNode` or the raw JSON; optional `PaymentHelperOptions` with `goal` and `clickId`) and the pure `buildFrom*` builders. The helpers read only the reference, aliases, status, amount, currency, time, test flag and `cg_click_id`, with exact decimals. New `PaymentConfirmation` model. The private-mode guard has a `payment_confirmation` allow-list. The Spring Boot starter's `Clikgate` bean exposes them as well. Conformance suite `payments`.

### Changed
- Conformance suite `compat`: unknown response fields and enum values are kept, never an error.
- **Fraud rules and the fraud test lab (backend, 2026-10-28):** the generated API layer is regenerated (757 operations; 461 kept). New fraud rules operation (`GET /v1/fraud/rules`, `FraudRulesDetailResponse`, plans with fraud insights). `FraudSampleResponse` (`createFraudSample`) no longer has `score` or `threshold`, `reasons` is `{rule, name}[]` (`FraudSampleReason`) and `FraudSamplePlanOutcome` has no `threshold`. These are removals from a response type.

## [1.1.0] - unreleased

### Added
- **Metadata filters:** `metadata` on the typed `api().links().listLinks`, `api().analytics().analyticsSummary`, `analyticsTimeseries`, `topLinks` and `openInAppAnalytics` methods and on `links().list` / `listPage`. A map such as `Map.of("seller_id", "sel_ada")` under the `"metadata"` key of the query map is sent as `metadata[seller_id]=sel_ada` (SPEC section 21). The backend reads these from the raw query string, so the codegen adds the parameter (`codegen/filter.mjs`).
- **Webhook `subscription.updated`:** documented on the webhook event type; it carries the subscription with `add_ons`, `change` and `add_on_key`. `type` stays a plain string, so nothing else changes. Conformance `webhooks.valid.subscription_updated`.
- `Link.getMetadata()` (empty map when none) and `Link.getExternalReference()`.
- The generated `api()` layer is regenerated from the final backend `openapi.json` (756 operations; 460 kept). `end_goal_value` comes back as decimal strings per currency next to `end_goal_value_minor`.
- `GoalEvent.getValueMinor()`, `getReversedValue()` and `getReversedValueMinor()`: the amounts in minor units (`Long`) next to the decimal strings, as the API returns them.

### Changed
- `goals().send` and `goal()` in sync mode send a random UUID v4 `Idempotency-Key` per call, reused across that call's retries, instead of `sha256(goal:reference)`. The API dedupes goal events by goal and reference itself, so a resend still never counts twice. `RequestOptions.idempotencyKey` still overrides the key.

## [1.0.0] - unreleased (first release)

### Added
- `Clikgate` (builder, `fromEnv()`):
  - `goal()` (background daemon thread with batching, or sync; never throws);
  - `goals().send`, `sendBatch` and `reverse`;
  - `flush`, `close`, and a JVM shutdown hook.
- `conversions()`, and `links()`: `create`, `get`, `update` (`LinkUpdateResult`, `LinkLockedException`), lazy `list`, `listPage` and `qr`. Also `clicks().get`.
- `ClickIds` (`fromRequest`, `isValid`, `cookieHeader`, `persist`, `fromPaymentMetadata`) and `Webhooks.verify` / `verifyAny`.
- The private-mode guard, typed unchecked exceptions, money as decimal strings (`BigDecimal`, `long`, `String`), retries with full jitter and `Retry-After`, and deterministic goal idempotency keys.
- `clikgate.api()`: every API-key operation, generated from openapi.json.
- A built-in HTTP/1.1 transport (PATCH on Java 8, a proxy with `Proxy-Authorization`, keep-alive), and the pluggable `Transport`, `Clock` and `ClikgateLogger`.
- `clikgate-spring-boot-starter` (Spring Boot 4), `clikgate-servlet-jakarta` and `clikgate-servlet-javax`.
