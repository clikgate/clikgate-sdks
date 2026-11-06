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

**One method, two kinds.** `goal()` is the only goal method on every platform. Each goal is **Standard** or **Payment** (`GoalKind`), set in the dashboard, never in the call. Every goal call returns a `GoalStatus`: `counted`, `waiting` (a Payment goal waiting for its confirmation) or `refused`, with a `reason`.

**App goals need Growth.** The mobile SDKs' `goal()` (and `track()`) report through install attribution, which is on Growth and up. On Free and Starter they log one "needs Growth" warning and do nothing (no error). Add them anyway when the user asks: they count from the upgrade on, with no code change.

For a goal that completes later, keep the click ID with the business's record when the user starts:
- web: `Clikgate.clickId()`;
- apps: `attributionMetadata()` returns `cg_click_id`;
- server: `clickIds.fromRequest`.

Then send it as `click_id` when the goal happens.

## Rules

- **Key:** snake_case, 2–40 characters (`^[a-z][a-z0-9_]*$`), and a goal defined in the dashboard. An unknown or archived goal is rejected.
- **Reference:** the business's own ID for the event (application number, order ID, transaction reference), 1–128 characters. **Never customer data:** no names, emails, phone numbers, account numbers or user IDs.
  - The same key and reference again is ignored (idempotent). The SDKs send a random `Idempotency-Key` per request on top; never build one from the reference.
  - If the app omits it, the SDK makes a random one, which the server can never reverse. Pass a real reference when there is one.
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

App goals are queued, batched and retried like events, and attributed to the latest Clikgate link that opened the app, else the install. While consent is required and attribution consent is unknown, they wait on the device.

## Defining goals from code (optional)

Goals are usually created in the dashboard (Settings › Goals). A backend that manages them itself uses the goals API with an API key that has the `org:manage` scope (owners and admins); reading needs `analytics:read` or `conversions:read`:

| Call | Node: the client's `api.goals` | Notes |
|---|---|---|
| `POST /v1/goals` `{name, key?, kind?, value_mode?, default_currency?, count_mode?, window_days?}` | `createGoal(body)` | the key is generated from the name when omitted; `kind` is `standard` (default) or `payment` (Starter and up; forces `value_mode: required`) |
| `GET /v1/goals` | `listGoals()` | |
| `GET /v1/goals/{key}` / `PATCH /v1/goals/{key}` | `fetchGoal(key)` / `updateGoal(key, body)` | the key can change only until the goal's first event (`409 goal_key_locked`); changing `kind` after recent browser or app values answers `409 kind_change_needs_confirmation`: resend with `confirm_kind_change: true` only after the user agrees |
| `POST /v1/goals/{key}/archive` | `archiveGoal(key)` | archived goals reject new events (`goal_archived`) |
| `/v1/funnels`, `/v1/funnels/{id}` | the client's `api.funnels` methods | funnels ending in an end goal |

Don't create goals as a side effect of app or web code. In Python, PHP, Java and .NET, call the same HTTP paths.

## Reversals (refunds, cancelled loans)

From the server: `clikgate.goals.reverse('order_paid', 'ORD-1001', { value: '500' })` (Node), or `POST /v1/goals/events/reverse`. A partial value is allowed. The completion still counts, and the reported value drops.

## Private mode (Growth plan and up)

Private mode is an organisation setting for businesses with strict security and privacy needs, for example in financial services, insurance and health. The organisation's owner turns it on in the dashboard; don't try to turn it on from code. When it is on:

- Clikgate accepts only `goal`, `click_id` or `code`, `reference`, `value`, `currency`, `provider`, `is_first`, `occurred_at` and the four-purpose `consent` object. It refuses everything else, including `metadata`, emails, phone numbers, names, customer IDs and hashed identifiers, with `422 private_mode_field_rejected` (`param` names the field).
- Mobile SDKs drop the customer ID of `identifyUser()` and event properties or revenue on the device; labels only go when the organisation allows labels in private mode. `goal()` works as usual, so send outcomes and values through `goal()`.
- The Node SDK refuses those fields before sending (`PrivateModeFieldRejectedError`).

Write goal code that works in both modes: send only the allowed fields.

## Who the user is: `identifyUser()` and labels

- Apps: `identifyUser(label, customerId, identityToken)` after sign-in (all optional; leave `customerId` out to keep it, `null` clears it on logout). Websites: `Clikgate.identifyUser({ label, customerId })` (labels only when the organisation allows labels from the browser). Servers: `identifyUser` with a click ID, an app installation or a customer ID (`POST /v1/people/identify`). There is no `identify()` any more: never write it.
- `label` is what the team sees instead of the click ID (1-80 characters; Growth and up). Ask the user what to put in it; don't put information in labels that customers wouldn't expect the business to keep. `goal()` takes the same `label`.
- `isFirst` on `goal()` is sent from apps and websites but only the server's `isFirst` counts a new customer, so send it from the server when there is one.

