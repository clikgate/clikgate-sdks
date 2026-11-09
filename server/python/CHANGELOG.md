# Changelog: clikgate (Python)

All notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/). Deprecations are announced at least 6 months ahead, and Python versions are dropped only after their end of life.


## [Unreleased]

### Strict goal names
- With the organisation's "Allow unknown goal names" off, the API refuses a goal name that isn't set up with `422 unknown_goal`, and an archived goal with `422 goal_archived`. Both are `InvalidRequestError` (`ClikgateError.code` is the reason) and final: never retried, never re-queued; background `goal()` passes them to `onError` as dropped. The SDK never checks names itself and never remembers the refusal.
- A `422` answered with the refusal body `{"status": "refused", "reason": ...}` (no error envelope) now maps to that reason instead of `http_422`; the body is the error's raw object.
- With debug logging on (the `clikgate` logger at `DEBUG`), each refusal logs "Goal `{name}` isn't set up in Clikgate" with the goal name only.

### Identity tokens, one goal() method

- **Added:** `clikgate.create_identity_token(customer_id, *, app_id=None, secret=None, issued_at=None)` (no API key needed) and `Clikgate.create_identity_token(customer_id, *, app_id=None, issued_at=None)` (also a plain method on `AsyncClikgate`): `base64url_nopad(HMAC_SHA256(secret, customer_id + "." + issued_at)) + "." + issued_at`, the signer Clikgate verifies with, with no network call. The secret comes from `secret`, else (with `app_id`) that app's entry in the `identity_secrets` option / `CLIKGATE_IDENTITY_SECRETS` (a JSON object), else the `identity_secret` option / `CLIKGATE_IDENTITY_SECRET`. Errors: `ConfigurationError` (`missing_identity_secret`, `invalid_identity_secrets`), `InvalidRequestError` (`invalid_customer_id`: 1-255 characters; never echoed), and the new `ClikgateServerOnlyError` (`server_only`) in browser or mobile Python builds (Pyodide / Emscripten / WASI, CPython on iOS or Android). Tested against the shared vectors in `server/conformance/vectors/identity-token-vectors.json`. Guide: https://clikgate.com/docs/identify-users.
- **Docs:** `identify_user()` documents path B (no secret or token): your server calls `identify_user(app_id=…, installation_id=…, customer_id=…, label=…)` with the installation ID the app sends at sign-in and at every signed-in app open, and skips the call when there is none.
- **Added:** `GoalStatus.RECEIVED` `received`: `goal()` / `goals.send` with a name that isn't ticked as a goal yet (or an archived goal) answers `200` with `status: "received"` and `reason` `not_counted_yet` (or `goal_archived`). It is a result, like `waiting` and `refused`: never an error and never retried.
- **Removed (generated API):** the app events resource (`clikgate.api.app_events` and `AppEventsApi`): List App Events (`GET /v1/app-events`), Report App Events (`POST /v1/apps/{app_id}/events`) and the Event rules operations (`/v1/apps/{app_id}/event-rules`). Clikgate has one method for anything that happens in an app, website or server, `goal()`; names not ticked as goals yet show in the dashboard's "Seen from your app and website". No released version ever had them (the generator drops them through `server/codegen/removed.mjs` until the backend's public document no longer lists them).

### Hashed email and phone for ad network matching

- **Added:** `hash_for_ads(email=None, phone=None)` → `HashedIdentifiers` (`hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`; only the fields given), to pass as `**kwargs` to `goal()`. Pure and offline: the email is trimmed and lowercased (must contain `@`); the phone must start with `+` or `00` and be 7-15 digits starting with 1-9 (E.164). Bad input is a local `invalid_argument` (`param` `email` / `phone`, never echoed).
- **Added:** goal options `hashed_email`, `hashed_phone_e164` and `hashed_phone_digits` (`goal()`, `goals.send`, batch events; sync and async); `conversions.create` takes the same fields. A value that isn't 64 lowercase hex characters is a local `invalid_hashed_identifier` (`param` = the field; the value is never echoed). The private-mode guard allows the three fields on goals and conversions; hashed values are never logged.

### Keep the click ID longer

- **Added:** `clikgate.click_ids.keep_route(days=30, secure=True, domain=None)`, the `/cg/keep` route for the web script's `data-server-endpoint="/cg/keep"`: the framework-neutral `handle_keep(method, headers, body)`, plus `clikgate.django.keep_view()`, `clikgate.flask.keep_view()` and `clikgate.starlette.keep_endpoint()` / `clikgate.fastapi.keep_endpoint()` (also as `route.django_view`, `route.flask_view`, `route.starlette_endpoint`). Same-origin `POST` only, a valid click ID matching the page URL's, `no-store`, empty bodies, never a redirect. `days` outside 1-400 is `invalid_argument`.
- **Added:** `clikgate.click_ids.context(request)` → `{"click_id", "kept_by", "browser_engine", "platform"}` for a goal's options (the User-Agent is parsed in the SDK, never sent).
- **Added:** goal options `kept_by`, `browser_engine` and `platform` (`goal()`, `goals.send`, batch events; sync and async; unknown values are a local `invalid_argument`), allowed by the private-mode guard.
- **Changed:** `persist()` and the Django, Flask and Starlette/FastAPI add-ons also write the `_cg_kept=s` marker cookie (same `Path`, `Max-Age`, `Domain`, `SameSite`, `Secure`), so the web script reports `kept_by: server_cookie`.

### identifyUser, goal labels, App banners

- **Added:** `clikgate.identify_user(click_id=… | app_id=… + installation_id=… | customer_id=…, label=…)` (sync and async) → `POST /v1/people/identify`: at least one reference (a click, an app installation or a customer ID; with a click or installation the customer ID links it). Always verified, so it also satisfies a referral program's `require_identity_token`. Local `invalid_request` without a reference or with half an installation. In private mode the guard refuses the customer ID; `label` passes (the API needs "Allow labels in private mode", else `422 labels_off_in_private_mode`).
- **Added:** goals take `label` (the person's label, 1-80 characters; Growth and up), allowed by the private-mode guard.
- **Removed (generated API):** the app server-identify operation (`POST /v1/apps/{app_id}/identify`); use `identifyUser`. The Journeys API is now the App banners API (`AppBannersApi`, `app_banner_id`, `AppBanner*` types, type `full_screen`, webhooks `app_banner.published` / `app_banner.paused`); IDs keep the `jrn_` prefix.
- **Regenerated** from the current public OpenAPI (523 operations), including the share events, QR, referral map, single sign-on, people, customer cost).

### Breaking
- **Goal results carry the goal call's outcome.** `GoalEvent["status"]` is now the `GoalStatus`: `counted`,
  `waiting` (a Payment goal waiting for its confirmation, or an event waiting for its click) or `refused` (with
  `reason`). The conversion state that `status` held before (`attributed`, `unattributed`, `rejected_bot`, …) is in
  the new `event_status`. Code that compared `status` with `"attributed"` must read `event_status`, or test
  `status == GoalStatus.COUNTED`.
- `goals.send` and `goals.send_batch` (sync and async) return `status` and `goal_kind` as `GoalStatus` / `GoalKind`
  members when the value is known (they are `str`, so JSON and string comparisons keep working).
- Goal management (`api.goals.*`): the goal object has `kind` (`GoalKind`) and `suggest_payment` instead of
  `confirmation`; `update_goal` takes `kind` and `confirm_kind_change`.
- There is no separate payment method in the web script or the app SDKs any more: a website or app reports a payment
  with `goal()` on a Payment goal. The server helpers below are unchanged.
- Payment confirmations need the Starter plan or above: Free gets `403 plan_feature_unavailable` (was
  `plan_upgrade_required`).

### Added
- **Private mode allows `consent`** (the four-purpose consent object) on goals, batch items and conversions, as the API does; it was refused locally before. Payment confirmations also allow the API's structural `refund_id` and `source_plugin` (through `extra`).
- `conversions.create` is typed `Conversion | GoalEvent`: on a Payment goal the API answers with the goal event (`object == "goal_event"`). Send `provider` and the payment reference there; a server Payment goal has no default provider (`422 payment_goal_needs_confirmation` with `missing`).
- `GoalKind`, `GoalStatus` and `Provider` enums (`from clikgate import GoalKind, GoalStatus, Provider`), generated
  from the API's OpenAPI document. `Provider` lists every payment gateway, plus `shopify`, `woocommerce` and `custom`.
- `provider` on `goal()`, `goals.send` and batch events: a `Provider` or a provider-key string (a newer gateway). A
  malformed one raises `InvalidRequestError` `invalid_provider` locally. Private mode allows it.
- `payments.confirm(provider=...)` takes a `Provider` or a string.
- `GoalEvent` keys `goal_kind`, `value_ignored`, `event_status` and `payment` (`GoalPaymentInfo`: a Payment goal sent
  by your server becomes a trusted confirmation).
- Conformance suite `compat`: unknown response fields and enum values are ignored and kept.
- **Payments confirmed by your server (SPEC section 22).** `payments.confirm(...)` posts
  `POST /v1/payments/confirmations`. `payments.from_paystack`, `from_flutterwave`, `from_monnify` and `from_stripe` (sync and async) read
  only the reference, status, amount, currency, time and `cg_click_id` from the gateway's verified response, and
  send them.
  - `build_from_*` (also exported as functions) return the body without sending it.
  - Amounts are exact decimals.
  - The private-mode guard has a new kind, `payment_confirmation`.
  - New warning code: `unrecognised_payment_response`.
  - New types: the `PaymentConfirmation` and `PaymentConfirmationBody` TypedDicts.
  - Conformance suite `payments`.

### Changed
- **Fraud rules and the fraud test lab (2026-10-28):** the generated `api.*` layer is regenerated (757 operations; 461 kept). New `api.ad_fraud.fetch_fraud_rules()` (`GET /v1/fraud/rules`, `FraudRulesDetailResponse`, plans with fraud insights). `FraudSampleResponse` (`create_fraud_sample`) no longer has `score` or `threshold`, `reasons` is `{rule, name}[]` (`FraudSampleReason`) and `FraudSamplePlanOutcome` has no `threshold`. These are removals from a response type.

## [1.1.0] - unreleased

### Added
- **Metadata filters:** `metadata` on the typed `api.links.list_links`, `api.analytics.analytics_summary`, `analytics_timeseries`, `top_links` and `open_in_app_analytics` methods and on `links.list` / `links.list_page`. A map such as `{"seller_id": "sel_ada"}` is sent as `metadata[seller_id]=sel_ada` (SPEC section 21). The API reads these from the raw query string, so the codegen adds the parameter (`codegen/filter.mjs`).
- **Webhook `subscription.updated`:** documented on the webhook event type; it carries the subscription with `add_ons`, `change` and `add_on_key`. `type` stays a plain string, so nothing else changes. Conformance `webhooks.valid.subscription_updated`.
- The generated `api.*` layer is regenerated from the final `openapi.json` (756 operations; 460 kept). `AnalyticsRowResponse.end_goal_value` is `Dict[str, str]` (decimal strings per currency) next to `end_goal_value_minor`.
- `GoalEvent["value_minor"]` and `["reversed_value_minor"]` (`int`): the amounts in minor units next to `value` and `reversed_value` (decimal strings), as the API returns them.

### Changed
- `goals.send` and `goal()` in sync mode send a random UUID v4 `Idempotency-Key` per call, reused across that call's retries, instead of `sha256(goal + ":" + reference)`. The API dedupes goal events by goal and reference itself, so a resend still never counts twice. The `idempotency_key` request option still overrides the key.

## [1.0.0] - unreleased (first release)

### Added
- `Clikgate` (sync, thread-safe) and `AsyncClikgate` (asyncio) clients:
  - `goal()` (background queue with batching on a daemon thread or event-loop task; never raises);
  - `goals.send`, `goals.send_batch` and `goals.reverse`;
  - `flush()`, `close()`, and flush at exit (`atexit`).
- `conversions.create` and `conversions.reverse` (older API).
- `links.create`, `get`, `update` (`202` → `{"applied": False, "change_request": …}`; `409 link_locked` → `LinkLockedError`), `list` (lazy iterator), `list_page` and `qr`.
- `clicks.get`.
- Click IDs: `click_ids.from_request`, `is_valid`, `cookie_header`, `persist` and `from_payment_metadata`.
- Webhooks: `clikgate.webhooks.verify` and `verify_any` (also without a client).
- The private-mode guard (`private_mode="auto" | True | False`), failing closed.
- Typed errors, money as decimal strings (`format_value`; `float` raises `TypeError`), retries with full jitter and `Retry-After`, deterministic goal idempotency keys.
- `clikgate.api.*`: every API-key operation, generated from openapi.json (sync and async).
- Add-ons (extras, no core dependencies): `clikgate.django`, `clikgate.flask`, `clikgate.fastapi` / `clikgate.starlette`.
