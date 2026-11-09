# Changelog: clikgate/clikgate-php

All notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/). Deprecations are announced at least 6 months ahead, and PHP versions are dropped only after their end of life.


## [Unreleased]

### Strict goal names
- With the organisation's "Allow unknown goal names" off, the API refuses a goal name that isn't set up with `422 unknown_goal`, and an archived goal with `422 goal_archived`. Both are `InvalidRequestError` (`getErrorCode()` is the reason) and final: never retried, never re-queued; background `goal()` passes them to `onError` as dropped. The SDK never checks names itself and never remembers the refusal.
- A `422` answered with the refusal body `{"status": "refused", "reason": ...}` (no error envelope) now maps to that reason instead of `http_422`; the body is the error's raw object.
- With debug logging on (the PSR-3 logger's `debug()`), each refusal logs "Goal `{name}` isn't set up in Clikgate" with the goal name only.

### Identity tokens, one goal() method

- **Added:** `\Clikgate\IdentityToken::create($customerId, ['appId' => …, 'secret' => …, 'issuedAt' => …])` (no API key needed) and `$clikgate->createIdentityToken($customerId, ['appId' => …])`: `base64url_nopad(HMAC_SHA256(secret, customerId . "." . issuedAt)) . "." . issuedAt`, the signer Clikgate verifies with, with no network call. The secret comes from `secret`, else (with `appId`) that app's entry in the `identitySecrets` option / `CLIKGATE_IDENTITY_SECRETS` (a JSON object), else the `identitySecret` option / `CLIKGATE_IDENTITY_SECRET`. Errors: `ConfigurationException` (`missing_identity_secret`, `invalid_identity_secrets`) and `InvalidRequestException` (`invalid_customer_id`: 1-255 characters of UTF-8; never echoed). PHP has no browser or mobile build, so there is no server-only check. Tested against the shared vectors in `server/conformance/vectors/identity-token-vectors.json`. Guide: https://clikgate.com/docs/identify-users.
- **Docs:** `identifyUser()` documents path B (no secret or token): your server calls `identifyUser(['appId' => …, 'installationId' => …, 'customerId' => …, 'label' => …])` with the installation ID the app sends at sign-in and at every signed-in app open, and skips the call when there is none.
- **Added:** `GoalStatus::Received` `received`: `goal()` / `goals.send` with a name that isn't ticked as a goal yet (or an archived goal) answers `200` with `status: "received"` and `reason` `not_counted_yet` (or `goal_archived`). It is a result, like `waiting` and `refused`: never an error and never retried.
- **Removed (generated API):** the app events resource (`$clikgate->api->appEvents` and `AppEventsApi`): List App Events (`GET /v1/app-events`), Report App Events (`POST /v1/apps/{app_id}/events`) and the Event rules operations (`/v1/apps/{app_id}/event-rules`). Clikgate has one method for anything that happens in an app, website or server, `goal()`; names not ticked as goals yet show in the dashboard's "Seen from your app and website". No released version ever had them (the generator drops them through `server/codegen/removed.mjs` until the backend's public document no longer lists them).

### Hashed email and phone for ad network matching (change 19)

- **Added:** `Clikgate\HashForAds::hash(?string $email = null, ?string $phone = null)` → the goal options `hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits` (only those given), to merge into a goal's options. Pure and offline: the email is trimmed and lowercased (must contain `@`); the phone must start with `+` or `00` and be 7-15 digits starting with 1-9 (E.164). Bad input is a local `invalid_argument` (`param` `email` / `phone`, never echoed).
- **Added:** goal options `hashedEmail`, `hashedPhoneE164` and `hashedPhoneDigits` (wire `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`; `goal()`, `goals->send()`, batch events); `conversions->create()` takes the same wire fields. A value that isn't 64 lowercase hex characters is a local `invalid_hashed_identifier` (`param` = the wire field; the value is never echoed). The private-mode guard allows the three fields on goals and conversions; hashed values are never logged.
- Conformance op `hash_for_ads`.

### Keeping the click ID (change 16)

- **Added:** `$clikgate->clickIds->keepRoute(['days' => 30, 'secure' => true, 'domain' => …])`: the `/cg/keep` route as a PSR-15 handler (`Clikgate\Psr15\KeepRouteHandler`) for the web script's `data-server-endpoint="/cg/keep"`. Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less); when your server saves it, it lasts as long as you choose, up to the browser's limit. Same-origin `POST` only (`Sec-Fetch-Site`, else `Origin` = host), a JSON body of at most 1 KB with matching `click_id` and `page_click_id`, `204` with `Cache-Control: no-store, private`; 400/403/405 otherwise; never a redirect, never echoed or logged. `days` must be 1-400 (`invalid_argument`). The framework-neutral core is `keepRouteCore()->respond($method, $headers, $body)`.
- **Added:** `$clikgate->clickIds->context($request)`: `clickId`, `keptBy` (`server_cookie`, `script_cookie`, `form` or null), `browserEngine` and `platform`, parsed from the `User-Agent` in the SDK (the User-Agent is never sent). Also `ClickIds::browserEngine()` and `ClickIds::platform()`.
- **Added:** goal options `keptBy`, `browserEngine` and `platform` (wire `kept_by`, `browser_engine`, `platform`), checked against their values locally (`invalid_argument`) and allowed by the private-mode guard.
- **Changed:** `persist()` (and `ClikgateMiddleware`) also sets the marker cookie `_cg_kept=s` after the click-ID cookie, with the same `Path`, `Max-Age`, `Domain`, `SameSite` and `Secure`, so the web script reports `kept_by: server_cookie`. New `markerHeader()`.
- Conformance ops `click_ids.keep` and `click_ids.context`.

### identifyUser, goal labels, App banners

- **Added:** `$clikgate->identifyUser(['clickId' => …, 'customerId' => …, 'label' => …])` → `POST /v1/people/identify`: at least one reference (a click, an app installation or a customer ID; with a click or installation the customer ID links it). Always verified, so it also satisfies a referral program's `require_identity_token`. Local `invalid_request` without a reference or with half an installation. In private mode the guard refuses the customer ID; `label` passes (the API needs "Allow labels in private mode", else `422 labels_off_in_private_mode`).
- **Added:** goals take `label` (the person's label, 1-80 characters; Growth and up), allowed by the private-mode guard.
- **Removed (generated API):** the app server-identify operation (`POST /v1/apps/{app_id}/identify`); use `identifyUser`. The Journeys API is now the App banners API (`AppBannersApi`, `app_banner_id`, `AppBanner*` types, type `full_screen`, webhooks `app_banner.published` / `app_banner.paused`); IDs keep the `jrn_` prefix.
- **Regenerated** from the current public OpenAPI (523 operations), including the share events, QR, referral map, single sign-on, people, customer cost).

### Breaking
- **Goal results carry the goal call's outcome.** A goal event's `status` is now a `GoalStatus` value: `counted`,
  `waiting` (a Payment goal waiting for its confirmation, or an event waiting for its click) or `refused` (with
  `reason`). The conversion state that `status` held before (`attributed`, `unattributed`, `rejected_bot`, …) is in
  the new `event_status`. Code that compared `$event['status']` with `'attributed'` must read `event_status`, or test
  `GoalStatus::tryFrom($event['status']) === GoalStatus::Counted`.
- Goal management (`api->goals->*`): the goal object has `kind` and `suggest_payment` instead of `confirmation`;
  `updateGoal` takes `kind` and `confirm_kind_change`.
- Removed `Goals::idempotencyKey()` (deprecated and unused since 1.1.0).
- There is no separate payment method in the web script or the app SDKs any more: a website or app reports a payment
  with `goal()` on a Payment goal. The server helpers below are unchanged.
- Payment confirmations need the Starter plan or above: Free gets `403 plan_feature_unavailable` (was
  `plan_upgrade_required`).

### Added
- **Private mode allows `consent`** (the four-purpose consent object) on goals, batch items and conversions, as the API does; it was refused locally before. Payment confirmations also allow the API's structural `refund_id` and `source_plugin` (through `extra`).
- `conversions->create()` on a Payment goal returns the goal event array (`'object' => 'goal_event'`). Send `provider` and the payment reference there; a server Payment goal has no default provider (`422 payment_goal_needs_confirmation` with `missing`).
- Backed enums `Clikgate\Enum\GoalKind` (`GoalKind::Payment`), `GoalStatus` (`GoalStatus::Counted`) and `Provider`
  (`Provider::Paystack`), generated from the API's OpenAPI document. `Provider` lists every payment gateway, plus
  `shopify`, `woocommerce` and `custom`.
- The `provider` goal option (`goal()`, `goals->send()`, batch events): a `Provider` or a provider-key string (a newer
  gateway). A malformed one throws `InvalidRequestException` `invalid_provider` locally. Private mode allows it.
- `payments->confirm(['provider' => Provider::Paystack, ...])` takes a `Provider` or a string.
- Goal events carry `goal_kind`, `value_ignored`, `event_status` and `payment` (a Payment goal sent by your server
  becomes a trusted confirmation).
- Conformance suite `compat`: unknown response fields and enum values are ignored and kept.
- **Payments confirmed by your server (SPEC section 22):** `$clikgate->payments->confirm([...])` (`POST /v1/payments/confirmations`). There are also helpers that build the body from a gateway's verified response: `fromPaystack()`, `fromFlutterwave()`, `fromMonnify()` and `fromStripe()`, with pure `buildFrom*()` variants. They read only the reference, status, amount, currency, time, test flag and `cg_click_id`. Amounts are exact decimals and never floats, and raw JSON text is parsed without losing digits. Local validation, the private-mode guard (kind `payment_confirmation`) and the `unrecognised_payment_response` warning are included. Conformance suite `payments`.

### Changed
- **Fraud rules and the fraud test lab (2026-10-28):** the generated API layer is regenerated (757 operations; 461 kept). New fraud rules operation (`GET /v1/fraud/rules`, `FraudRulesDetailResponse`, plans with fraud insights). `FraudSampleResponse` (`createFraudSample`) no longer has `score` or `threshold`, `reasons` is `{rule, name}[]` (`FraudSampleReason`) and `FraudSamplePlanOutcome` has no `threshold`. These are removals from a response type.

## [1.1.0] - unreleased

### Added
- **Metadata filters:** `metadata` on the typed `api->links->listLinks`, `api->analytics->analyticsSummary`, `analyticsTimeseries`, `topLinks` and `openInAppAnalytics` methods and on `links->list` / `listPage`. A map such as `['seller_id' => 'sel_ada']` is sent as `metadata[seller_id]=sel_ada` (SPEC section 21). The API reads these from the raw query string, so the codegen adds the parameter (`codegen/filter.mjs`).
- **Webhook `subscription.updated`:** documented in SPEC section 20; it carries the subscription with `add_ons`, `change` and `add_on_key`. `type` stays a plain string, so nothing else changes. Conformance `webhooks.valid.subscription_updated`.
- The generated `api->*` layer is regenerated from the final `openapi.json` (756 operations; 460 kept). `end_goal_value` comes back as decimal strings per currency next to `end_goal_value_minor`.
- Goal events returned by `goals->send()` and the batch carry `value_minor` and `reversed_value_minor` (int) next to `value` and `reversed_value` (decimal strings), as the API returns them; nothing is converted to float.

### Changed
- `goals->send()` and `goal()` in sync mode send a random UUID v4 `Idempotency-Key` per call, reused across that call's retries, instead of `sha256(goal:reference)`. The API dedupes goal events by goal and reference itself, so a resend still never counts twice. The `idempotencyKey` request option still overrides the key.

## [1.0.0] - unreleased (first release)

### Added
- `Clikgate\Clikgate`: `goal()` (never throws; `sync`, `after_response` and `background` modes), `goals->send()`, `sendBatch()`, `reverse()`, `flush()`, `close()`.
- `conversions->create()` / `reverse()`, `links->create()`, `get()`, `update()` (`202` change requests, `LinkLockedException`), `list()` (lazy generator), `listPage()`, `qr()`, `clicks->get()`.
- Click IDs: `clickIds->fromRequest()` (PSR-7, Symfony/Laravel or globals), `isValid()`, `cookieHeader()`, `persist()`, `fromPaymentMetadata()`.
- `Webhooks::verify()` and `verifyAny()`.
- The private-mode guard, typed exceptions, decimal-string money, retries with full jitter and `Retry-After`, deterministic goal idempotency keys.
- `$clikgate->api->*`: every API-key operation, generated from openapi.json.
- `Clikgate\Psr15\ClikgateMiddleware`.
- Transports: ext-curl (timeouts, proxies) or any PSR-18 client via `php-http/discovery`.
