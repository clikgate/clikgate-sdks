# Goals: the end of the funnel

A **goal** is an outcome the business cares about: `account_opened`, `loan_disbursed`, `order_paid`, `first_trip`. The funnel starts with a click on a Clikgate link and ends with the organisation's **end goal**. Goals are defined in the dashboard (Settings › Goals). Every organisation has `purchase` and `signup`.

## Where to send a goal from

| The goal happens… | Send it from | How |
|---|---|---|
| in the app (a purchase screen) | the app | `Clikgate.goal(...)` (mobile SDKs 1.3.0+) |
| on the website (a confirmation page) | the page | `Clikgate.goal(...)` in the web script; see [web.md](web.md) |
| later, on the backend (an account approved days later) | the server | `clikgate.goal(...)` (Node) or `POST /v1/goals/events`; see [server-sdks.md](server-sdks.md) |
| as a payment (Paystack, Flutterwave, Shopify, WooCommerce) | nothing to code | the dashboard's sales connection turns successful payments into the goal (default `purchase`) |
| as a payment the page or app sees succeed, on a **Payment goal** | the page or app reports it; a trusted source confirms it | `Clikgate.goal(key, provider, reference)` in each platform's style (no amount), then a confirmation route. The server route is `goals.send` with the value, or `payments.fromPaystack(...)` and the other helpers, right after the server's own verification. See [payments.md](payments.md) |

**Prefer the server for goals with a value:** values sent from a browser or app can be changed by the user. For payments, use a Payment goal ([payments.md](payments.md)): the amount then always comes from the confirmed payment.

**One method, two kinds.** `goal()` is the only goal method on every platform. Each goal is **Standard** or **Payment** (`GoalKind`), set in the dashboard, never in the call. Every goal call returns a `GoalStatus`: `counted`, `waiting` (a Payment goal waiting for its confirmation), `received` (stored, not counted yet) or `refused`, with a `reason`. All four are results, not errors, and none is retried. One exception is answered as an error and is still final: with the organisation's "Allow unknown goal names" off, a live name with no goal behind it is `422 unknown_goal` (see Rules).

**Events and goals work on every plan, up to the plan's allowance. Growth and up add re-engagement, Apple Ads, install fraud scoring, and uninstall tracking on Pro.**

**The dashboard chooses what counts.** `goal()` is the only method for anything that happens in an app, website or server. Every name sent with it appears in the dashboard's "Seen from your app and website" (name, count, last received, source). It counts in reports, goes to ad networks and uses the plan's allowance only after the team ticks "Count this as a goal" (goals created on the Goals page count from the start). Until then the call returns `status: received` with reason `not_counted_yet`. After adding a new name, tell the user to tick it in the dashboard.

For a goal that completes later, keep the click ID with the business's record when the user starts:
- web: `Clikgate.clickId()`;
- apps: `attributionMetadata()` returns `cg_click_id`;
- server: `clickIds.fromRequest`.

Then send it as `click_id` when the goal happens.

## Rules

- **Name (key):** snake_case, 2–40 characters (`^[a-z][a-z0-9_]{1,39}$`); other names are refused with a clear error. A name that isn't a goal yet is stored, not counted (`received`, `not_counted_yet`); so is an event for an archived goal (`received`, `goal_archived`) until the team chooses "Count again". Reuse the exact name the dashboard shows: a near-duplicate (`purchase_done` for `purchase`) shows up as a separate name.
- **Unknown names, strict mode:** "Allow unknown goal names" (Settings › Goals) is on by default. When the team turns it off, live calls whose name has no goal or alias behind it are refused at once and nothing is stored (only a daily count per name):
  - HTTP: `422 {"error": {"type": "invalid_request", "code": "unknown_goal", "param": "goal", "status": "refused", "reason": "unknown_goal", "counted": false, "goal_kind": null, …}}`; an archived goal's name answers `422` with `goal_archived`.
  - App SDKs: `GoalStatus.REFUSED` (`.refused` on iOS) with `reason` `unknown_goal`. Web script: `{status: "refused", reason: "unknown_goal"}`. Server SDKs: `goals.send` raises the invalid-request error (`InvalidRequestError` in Node and Python, `InvalidRequestException` in PHP, Java and .NET) with code `unknown_goal`; background `goal()` passes it to the error handler as dropped; in a batch only that item fails.
  - Final everywhere: no retry, no offline re-queue. Debug builds log ``Goal `{name}` isn't set up in Clikgate`` (the name only).
  - Test keys always keep names (`received`), so a test build can't show this. The check order is: name format, key and mode, unknown or archived name, "Allow from browser", payment fields; so an unknown name with `provider` and `reference` answers `unknown_goal`.
  - Never check names in the app or cache the setting, and never create goals from app code to avoid it. Tell the user to set the goal up (or add the name as an alias) in the dashboard, or to turn the setting back on. The dashboard lists refused names for 30 days (`GET /v1/goal-name-refusals`).
- **Reference:** the business's own ID for the event (application number, order ID, transaction reference), 1–128 characters. **Never customer data:** no names, emails, phone numbers, account numbers or user IDs.
  - The same key and reference again is ignored (idempotent). The SDKs send a random `Idempotency-Key` per request on top; never build one from the reference.
  - If the app omits it, the SDK makes a random one, which the server can never reverse. Pass a real reference when there is one.
  - The same order sent from the app and the website (or under two names the team joined as one goal) counts once only when both send the same real order reference.
- **Value:** optional, in normal units (₦2,000,000 is `2000000`, never kobo or cents), at most 15 significant digits.
  - Android: `BigDecimal`. iOS: `Decimal`.
  - Flutter and React Native: a number or a numeric string. Use a string for decimals.
  - Node: a string. Python: `Decimal`. Java: `BigDecimal`. .NET: `decimal`.
  - Never use floating point for money.
- **Currency:** ISO 4217. When omitted, the goal's default currency is used.
- **isFirst:** the app's statement that this is the customer's first such event. Clikgate doesn't check it.

## App examples

```dart
await Clikgate.goal('account_opened', value: 2000000, currency: 'NGN', reference: 'APP-55231', isFirst: true);
await Clikgate.goal('order_paid', value: '1500.50', currency: 'NGN', reference: 'ORD-1001');
```

```ts
await Clikgate.goal('order_paid', { value: '1500.50', currency: 'NGN', reference: 'ORD-1001' });
```

```kotlin
Clikgate.goal("order_paid", GoalOptions(value = BigDecimal("1500.50"), currency = "NGN", reference = "ORD-1001"))
```

```swift
Clikgate.shared.goal("order_paid", value: Decimal(string: "1500.50")!, currency: "NGN", reference: "ORD-1001")
```

App goals are queued, batched and retried, and attributed to the latest Clikgate link that opened the app, else the install. While consent is required and attribution consent is unknown, they wait on the device.

## Defining goals from code (optional)

Goals are usually created in the dashboard (Settings › Goals). A backend that manages them itself uses the goals API with an API key that has the `org:manage` scope (owners and admins); reading needs `analytics:read` or `conversions:read`:

| Call | Node: the client's `api.goals` | Notes |
|---|---|---|
| `POST /v1/goals` `{name, key?, kind?, value_mode?, default_currency?, count_mode?, window_days?}` | `createGoal(body)` | the key is generated from the name when omitted; `kind` is `standard` (default) or `payment` (Starter and up; forces `value_mode: required`) |
| `GET /v1/goals` | `listGoals()` | |
| `GET /v1/goals/{key}` / `PATCH /v1/goals/{key}` | `fetchGoal(key)` / `updateGoal(key, body)` | the key can change only until the goal's first event (`409 goal_key_locked`); changing `kind` after recent browser or app values answers `409 kind_change_needs_confirmation`: resend with `confirm_kind_change: true` only after the user agrees |
| `POST /v1/goals/{key}/archive` | `archiveGoal(key)` | events for an archived goal are stored, not counted (`received`, reason `goal_archived`); with "Allow unknown goal names" off, live calls are refused (`422 goal_archived`) |
| `GET` / `PATCH /v1/goals/settings` `{allow_unknown_names}` | HTTP | read with `goals_payments:view`, change with `goals_payments:manage`; the team's choice, don't change it from code |
| `/v1/goal-groups`, `/v1/goal-groups/{id}`, `POST /v1/goal-groups/reorder` | HTTP | goal groups: labels that organise goals in the dashboard (at most 20 per mode; a goal is in one group at most; `group_id` on `/v1/goals`). They never change counting, ad network sending or webhooks |
| `/v1/funnels`, `/v1/funnels/{id}` | the client's `api.funnels` methods | funnels ending in an end goal |

Don't create goals as a side effect of app or web code. In Python, PHP, Java and .NET, call the same HTTP paths.

## Reversals (refunds, cancelled loans)

From the server: `clikgate.goals.reverse('order_paid', 'ORD-1001', { value: '500' })` (Node), or `POST /v1/goals/events/reverse`. A partial value is allowed. The completion still counts, and the reported value drops.

## Private mode (Growth plan and up)

Private mode is an organisation setting for businesses with strict security and privacy needs, for example in financial services, insurance and health. The organisation's owner turns it on in the dashboard; don't try to turn it on from code. When it is on:

- Clikgate accepts only `goal`, `click_id` or `code`, `reference`, `value`, `currency`, `provider`, `is_first`, `occurred_at` and the four-purpose `consent` object. It refuses everything else, including `metadata`, emails, phone numbers, names, customer IDs and hashed identifiers, with `422 private_mode_field_rejected` (`param` names the field).
- Mobile SDKs drop the customer ID of `identifyUser()` on the device; labels only go when the organisation allows labels in private mode. `goal()` works as usual, so send outcomes and values through `goal()`.
- The Node SDK refuses those fields before sending (`PrivateModeFieldRejectedError`).

Write goal code that works in both modes: send only the allowed fields.

## Who the user is: `identifyUser()` and labels

- Apps: `identifyUser(label, customerId, identityToken)` after sign-in and at app open when already signed in (all optional; leave `customerId` out to keep it, `null` clears it on sign-out). Websites: `Clikgate.identifyUser({ label, customerId })` (labels only when the organisation allows labels from the browser). Servers: `identifyUser` with a click ID, an app installation or a customer ID (`POST /v1/people/identify`). There is no `identify()` any more: never write it.
- `label` is what the team sees instead of the click ID (1-80 characters; Growth and up). Ask the user what to put in it; don't put information in labels that customers wouldn't expect the business to keep. `goal()` takes the same `label`.
- **The customer ID** is the business's own user ID from its database, the same on app, website and server. Never an email, phone number, BVN or NIN. Anonymous users need none of this: they're tracked by click or installation.
- **Verify it: two paths** (full guide: https://clikgate.com/docs/identify-users):

  | Path | How | Use when |
  |---|---|---|
  | **A: identity token (default)** | the server adds one field to the responses the app already calls (sign-in, "current user" / "me"); the app passes it as `identityToken` | always, unless the team prefers B: no extra server call |
  | **B: installation ID** | the app reads `getInstallationId()` and sends it in its sign-in request; the server calls `identifyUser({ appId, installationId, customerId, label? })` | the team doesn't want an identity secret |

  - **Path A setup:** the user creates the identity secret in Apps › the app › Identity secret and stores it as `CLIKGATE_IDENTITY_SECRET` on the server only (never in the app or the repository; add `CLIKGATE_IDENTITY_SECRET=` with no value to `.env.example`). Node: `createIdentityToken(user.id)` from `@clikgate/node`, no network call; several apps: `createIdentityToken(user.id, { appId })` with `CLIKGATE_IDENTITY_SECRETS` (a JSON object of app IDs to secrets). Other languages: [server-sdks.md](server-sdks.md). Tokens last 30 days by default; the app passes the newest one it has and nothing needs a scheduled refresh.
  - **Path B setup:** `getInstallationId()` is `null` when tracking is off (opt-out, consent denied, deep-link-only mode): send nothing and skip `identifyUser` on the server. Call it at every signed-in app open, not only at sign-in.
  - Debug builds log the reason when a token doesn't verify: `expired`, `bad_signature`, `secret_rotated`, `no_secret_set` or `not_yet_valid` (the server clock is ahead).
- `isFirst` on `goal()` is sent from apps and websites but only the server's `isFirst` counts a new customer, so send it from the server when there is one.

