# Changelog: @clikgate/node

All notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/). Deprecations are announced at least 6 months ahead, and Node versions are dropped only after their end of life.


## [Unreleased]

### Strict goal names
- With the organisation's "Allow unknown goal names" off, the API refuses a goal name that isn't set up with `422 unknown_goal`, and an archived goal with `422 goal_archived`. Both are `InvalidRequestError` (`ClikgateError.code` is the reason) and final: never retried, never re-queued; background `goal()` passes them to `onError` as dropped. The SDK never checks names itself and never remembers the refusal.
- A `422` answered with the refusal body `{"status": "refused", "reason": ...}` (no error envelope) now maps to that reason instead of `http_422`; the body is the error's raw object. `KnownErrorCode` gains `unknown_goal`.
- With debug logging on (a `logger` with a `debug` method), each refusal logs "Goal `{name}` isn't set up in Clikgate" with the goal name only.

### Identity tokens, one goal() method

- **Added:** `createIdentityToken(customerId, { appId?, secret?, issuedAt? })` (top-level export, no API key needed) and `clikgate.createIdentityToken(customerId, { appId? })`: `base64url_nopad(HMAC_SHA256(secret, customerId + "." + issuedAt)) + "." + issuedAt`, the signer Clikgate verifies with, with no network call. The secret comes from `secret`, else (with `appId`) that app's entry in the `identitySecrets` option / `CLIKGATE_IDENTITY_SECRETS` (a JSON object), else the `identitySecret` option / `CLIKGATE_IDENTITY_SECRET`. Errors: `ConfigurationError` (`missing_identity_secret`, `invalid_identity_secrets`), `InvalidRequestError` (`invalid_customer_id`: 1-255 characters; never echoed), and the new `ClikgateServerOnlyError` (`server_only`) when `window`, `document` or React Native (`navigator.product === "ReactNative"`) is detected. Tested against the shared vectors in `server/conformance/vectors/identity-token-vectors.json`. Guide: https://clikgate.com/docs/identify-users.
- **Docs:** `identifyUser()` documents path B (no secret or token): your server calls `identifyUser({ appId, installationId, customerId, label? })` with the installation ID the app sends at sign-in and at every signed-in app open, and skips the call when there is none.
- **Added:** `GoalStatus.Received` `received`: `goal()` / `goals.send` with a name that isn't ticked as a goal yet (or an archived goal) answers `200` with `status: "received"` and `reason` `not_counted_yet` (or `goal_archived`). It is a result, like `waiting` and `refused`: never an error and never retried.
- **Removed (generated API):** the app events resource (`clikgate.api.appEvents`, `AppEventsApi` and its `AppEvent*` / `*EventRule*` types): List App Events (`GET /v1/app-events`), Report App Events (`POST /v1/apps/{app_id}/events`) and the Event rules operations (`/v1/apps/{app_id}/event-rules`). Clikgate has one method for anything that happens in an app, website or server, `goal()`; names not ticked as goals yet show in the dashboard's "Seen from your app and website". No released version ever had them (the generator drops them through `server/codegen/removed.mjs` until the backend's public document no longer lists them).

### Hashed email and phone for ad network matching (change 19)

- **Added:** `hashForAds({ email, phone })` → `HashedIdentifiers` (`hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits`; only the fields given), to spread into goal options. Pure and offline: the email is trimmed and lowercased (must contain `@`); the phone must start with `+` or `00` and be 7-15 digits starting with 1-9 (E.164). Bad input is a local `invalid_argument` (`param` `email` / `phone`, never echoed).
- **Added:** goal options `hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits` (wire `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`) on `goal()`, `goals.send` and batch events; `conversions.create` takes the same wire fields. A value that isn't 64 lowercase hex characters is a local `invalid_hashed_identifier`. The private-mode guard allows the three fields on goals and conversions (the API accepts them there only while a destination matches by hashed identifiers). In private mode, hash on your own server.

### Keep the click ID longer (change 16)

- **Added:** `clikgate.clickIds.keepRoute({ days = 30, secure = true, domain? })`, the `/cg/keep` route for the web script's `data-server-endpoint="/cg/keep"`: a Fetch handler (`export const POST = clikgate.clickIds.keepRoute()` in a Next.js App Router route) with `.express`, `.node` and `.handle` adapters, and `keepRoute()` from `@clikgate/node/next`. Same-origin `POST` only, a valid click ID matching the page URL's, `no-store`, empty bodies, never a redirect. `days` outside 1-400 is `invalid_argument`.
- **Added:** `clikgate.clickIds.context(req)` → `{ clickId, keptBy, browserEngine, platform }` for a goal's options (the User-Agent is parsed in the SDK, never sent).
- **Added:** goal options `keptBy`, `browserEngine` and `platform` (sent as `kept_by`, `browser_engine`, `platform`; unknown values are a local `invalid_argument`), allowed by the private-mode guard. Types `KeptBy`, `BrowserEngine`, `Platform`.
- **Changed:** `persist()`, the Express/Fastify add-ons and the Next.js proxy also write the `_cg_kept=s` marker cookie (same `Path`, `Max-Age`, `Domain`, `SameSite`, `Secure`), so the web script reports `kept_by: server_cookie`.

### identifyUser, goal labels, App banners

- **Added:** `clikgate.identifyUser({ clickId | appId + installationId | customerId, label })` → `POST /v1/people/identify`: at least one reference (a click, an app installation or a customer ID; with a click or installation the customer ID links it). Always verified, so it also satisfies a referral program's `require_identity_token`. Local `invalid_request` without a reference or with half an installation. In private mode the guard refuses the customer ID; `label` passes (the API needs "Allow labels in private mode", else `422 labels_off_in_private_mode`).
- **Added:** goals take `label` (the person's label, 1-80 characters; Growth and up), allowed by the private-mode guard.
- **Removed (generated API):** the app server-identify operation (`POST /v1/apps/{app_id}/identify`); use `identifyUser`. The Journeys API is now the App banners API (`AppBannersApi`, `app_banner_id`, `AppBanner*` types, type `full_screen`, webhooks `app_banner.published` / `app_banner.paused`); IDs keep the `jrn_` prefix.
- **Regenerated** from the current public OpenAPI (523 operations), including the share events, QR, referral map, single sign-on, people, customer cost).

### Breaking
- **`GoalEvent.status` is now the goal call's outcome**, a `GoalStatus`: `counted`, `waiting` (a Payment goal
  waiting for its confirmation) or `refused`. The attribution state it used to hold (`attributed`, `unattributed`,
  `rejected_bot`, …) moved to the new `event_status`. Check `status === GoalStatus.Counted` (or `counted`) instead of
  `status === 'attributed'`.
- **Goal kinds replace the goal's `confirmation` setting** in the generated `api.goals.*` types: the goal object has
  `kind` (`GoalKind`) and `suggest_payment` instead of `confirmation`; `createGoal` / `updateGoal` take `kind`, and
  `updateGoal` also `confirm_kind_change` (`409 kind_change_needs_confirmation`). `ApiTypes.GoalStatus` is now the
  goal call's outcome; a goal's lifecycle (`active` / `archived`) is `ApiTypes.GoalState`.
- Payment features (Payment goals, `payments.confirm` and the helpers) need a Starter plan or above: Free gets
  `PermissionError` `plan_feature_unavailable` (it was `plan_upgrade_required` on the `sales_tracking` feature).
- `PaymentConfirmParams.provider`, `PaymentConfirmationBody.provider` and `PaymentConfirmation.provider` are typed
  `Provider | string` (was `string`; existing strings still compile).

### Added
- **Private mode allows `consent`** (the four-purpose consent object) on goals, batch items and conversions, as the API does; it was refused locally before. Payment confirmations also allow the API's structural `refund_id` and `source_plugin` (through `extra`).
- `conversions.create` returns `Conversion | GoalEvent`: on a Payment goal the API answers with the goal event (`object: 'goal_event'`). Send `provider` and the payment reference there; a server Payment goal has no default provider any more (`422 payment_goal_needs_confirmation` with `missing`).
- **`GoalKind`, `GoalStatus` and `Provider`**, exported as constants and types (`GoalKind.Payment`,
  `GoalStatus.Counted`, `Provider.Paystack`). They are generated from the API's OpenAPI description, so a new gateway
  shows up as `Provider.<Name>` when the SDK is regenerated.
- **`provider`** on `goal()`, `goals.send` and batch events: the payment provider of a Payment goal. A provider key
  string works too, for a gateway added after your SDK release. A malformed key is refused locally
  (`invalid_provider`). Private mode allows it.
- `GoalEvent` gains `goal_kind`, `value_ignored`, `event_status` and `payment` (the confirmation a Payment goal sent
  by your server became), and a `GoalPayment` type.
- `KnownErrorCode` gains `plan_feature_unavailable`, `invalid_provider`, `unknown_provider`, `code_not_supported` and
  `payment_goal_needs_confirmation`.
- The generated `api.*` layer is regenerated (473 operations kept): onboarding (`api.onboarding.*`), checklist
  skip and unskip, a link's first click, payment report fields (`primary`, `late_report`, `flags`, `hint`).
- Forward compatibility: unknown response fields and enum values are kept and never an error (conformance suite
  `compat`).

- **Payments confirmed by your server (SPEC section 22).** `payments.confirm({...})` posts
  `POST /v1/payments/confirmations`. `payments.fromPaystack`, `fromFlutterwave`, `fromMonnify` and `fromStripe` read
  only the reference, status, amount, currency, time and `cg_click_id` from the gateway's verified response, and
  send them.
  - `buildFrom*` (also exported as functions) return the body without sending it.
  - Amounts are exact decimals.
  - The private-mode guard has a new kind, `payment_confirmation`.
  - New warning code: `unrecognised_payment_response`.
  - New types: `PaymentConfirmParams`, `PaymentConfirmation`, `PaymentConfirmationBody`, `PaymentHelperOptions`
    and `PaymentStatus`.
  - Conformance suite `payments`.

### Removed
- Internal planning references in doc comments and in the generated types' descriptions.

### Changed
- **Fraud rules and the fraud test lab:** the generated `api.*` layer is regenerated (757 operations; 461 kept). New `api.adFraud.fetchFraudRules()` (`GET /v1/fraud/rules`, `FraudRulesDetailResponse`, plans with fraud insights). `FraudSampleResponse` (`createFraudSample`) no longer has `score` or `threshold`, `reasons` is `{rule, name}[]` (`FraudSampleReason`) and `FraudSamplePlanOutcome` has no `threshold`. These are removals from a response type.

## [1.1.0] - unreleased

### Added
- **Metadata filters:** `metadata` on the typed `api.links.listLinks`, `api.analytics.analyticsSummary`, `analyticsTimeseries`, `topLinks` and `openInAppAnalytics` methods and on `links.list` / `links.listPage`. A map such as `{ seller_id: 'sel_ada' }` is sent as `metadata[seller_id]=sel_ada` (SPEC section 21). The backend reads these from the raw query string, so the codegen adds the parameter (`codegen/filter.mjs`).
- **Webhook `subscription.updated`:** documented on the webhook event type; it carries the subscription with `add_ons`, `change` and `add_on_key`. `type` stays a plain string, so nothing else changes. Conformance `webhooks.valid.subscription_updated`.
- The generated `api.*` layer is regenerated from the final backend `openapi.json` (756 operations; 460 kept). `AnalyticsRowResponse.end_goal_value` is a map of decimal strings per currency next to `end_goal_value_minor`.
- `GoalEvent.value_minor` and `reversed_value_minor`: the amounts in minor units next to `value` and `reversed_value` (decimal strings), as the API returns them.

### Changed
- `goals.send` and `goal()` in sync mode send a random UUID v4 `Idempotency-Key` per call, reused across that call's retries, instead of `sha256(goal + ":" + reference)`. The API dedupes goal events by goal and reference itself, so a resend still never counts twice. The `idempotencyKey` request option still overrides the key.

## [1.0.0] - unreleased (first release)

### Added
- `Clikgate` client:
  - `goal()` (background queue with batching, never throws);
  - `goals.send`, `goals.sendBatch` and `goals.reverse`;
  - `flush()`, `close()`, and flush on `beforeExit`, `SIGTERM` and `SIGINT`.
- `conversions.create` and `conversions.reverse` (older API).
- `links.create`, `get`, `update` (`202` change requests become `{ applied: false, change_request }`; `409 link_locked` becomes `LinkLockedError`), `list` (auto-paginating) and `listPage`, `qr`, and `domain_badge` and `warnings` on links.
- `clicks.get`.
- Click IDs: `clickIds.fromRequest`, `isValid`, `cookieHeader`, `persist` and `fromPaymentMetadata` (Paystack, Flutterwave, Shopify, WooCommerce).
- Webhooks: `webhooks.verify` and `webhooks.verifyAny`, with a 300 s tolerance and constant-time comparison.
- The private-mode guard: `privateMode: 'auto' | true | false`; `auto` reads `GET /v1/server-sdk/config`, caches it for 10 minutes and fails closed.
- Typed errors (SPEC section 5), with `allowed` and `docUrl` (test links), and `requiredPlan` and `limit` (plan and test-link limits).
- Retries with full-jitter backoff and `Retry-After`. Idempotency keys: `sha256(goal + ":" + reference)` for goals, and a random UUID reused across retries for other calls.
- Money is always sent as a decimal string, with `formatValue`; numbers that may be inexact log a warning.
- `clikgate.api.*`: every API-key operation, generated from openapi.json.
- Add-ons:
  - `@clikgate/node/express` (Express 5 and Connect);
  - `@clikgate/node/fastify` (Fastify 5);
  - `@clikgate/node/next` (Next.js 16 `proxy.ts`, plus legacy `middleware.ts`).
- Builds: ESM, CJS and `.d.ts`; zero runtime dependencies; Node 18+.
- Types: `LinkChangeRequest` carries `requested_by_type`, `decision_note` and `livemode` (as the backend's `LinkChangeRequestInfoResponse`), and `KnownErrorCode` includes `https_required` and `destination_not_allowlisted` (link-safety `422`s).
