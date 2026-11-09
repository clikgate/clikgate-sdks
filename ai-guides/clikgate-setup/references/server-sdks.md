# Server SDKs

Use a server SDK to send goals that happen on the backend (an account approved, a loan disbursed, an order paid), keep the click ID, verify Clikgate webhooks and manage links.

| Language | Package | Status |
|---|---|---|
| Node.js / TypeScript (Node 18+) | `@clikgate/node` {{versions.node}} | **available**: `npm install @clikgate/node` |
| Python | `clikgate` | **not available yet**: use the HTTP API below |
| PHP / Laravel | `clikgate/clikgate-php`, `clikgate/clikgate-laravel` | **not available yet**: use the HTTP API below |
| Java / Kotlin / Spring Boot | `com.clikgate:clikgate-java` | **not available yet**: use the HTTP API below |
| C# / .NET | `Clikgate` | **not available yet**: use the HTTP API below |

Don't add a dependency on a package marked "not available yet": it isn't published. Tell the user it is coming, and use the HTTP API.

## Procedure

1. Read the project: the framework, where visitors land, where the business record is created (sign-up, application, order), and where the goal happens (approval, payment).
2. **Show the plan before changing anything:** the package to install, each file you'll change, and the code you'll add. Then wait for a yes. If the user approved in advance, still show the plan first, then go on.
3. Install the package, then make the edits:
   - capture the click ID on landing;
   - save it with the business record;
   - send the goal where it happens.
4. Run the project's typecheck or tests. Then tell the user:
   - to define the goal in the dashboard (Settings › Goals) if it isn't there yet;
   - to set `CLIKGATE_API_KEY` (a `cg_test_` key while testing).

## Keys

- The server uses an **API key**: `cg_test_…` while testing, `cg_live_…` in production. Read it from the `CLIKGATE_API_KEY` environment variable. Never put it in source code, committed config, the app or the browser.
- Add `CLIKGATE_API_KEY=` to the project's `.env.example` (no value), and tell the user to set the real value themselves.
- Mobile SDK keys (`cg_sdk_…`) and publishable web keys (`cgw_…`) don't work on the server.

## Node.js (`@clikgate/node`)

```sh
npm install @clikgate/node
```

Create one client and reuse it. `goal()` is the one goal method, for Standard and Payment goals alike. It never throws: it queues the event and sends it in the background, in batches, with safe retries. `goals.send()` waits and returns the result. Its status is a `GoalStatus`: `GoalStatus.Counted`, `Waiting`, `Received` or `Refused`, with a `reason`, plus `goal_kind`: `GoalKind.Standard` or `GoalKind.Payment`. `waiting`, `received` (the name isn't ticked as a goal in the dashboard yet) and `refused` are results, not errors, and are never retried.

```ts clikgate-check
import { Clikgate } from '@clikgate/node';

const clikgate = new Clikgate(); // reads CLIKGATE_API_KEY

export function onAccountApproved(application: { id: string; clickId: string | null }): void {
  clikgate.goal('account_opened', {
    clickId: application.clickId,
    reference: application.id, // your own reference, never customer data
    value: '2000000',          // normal units, as a string
    currency: 'NGN',
  });
}
```

### Keep the click ID (capture → save → send later)

The pattern: capture the click ID when the visitor lands, save it with the business's own record, and send the goal later from any job.

- **Express:**

  ```ts
  import { clikgateMiddleware } from '@clikgate/node/express';
  app.use(clikgateMiddleware(clikgate));      // keeps ?cgid=… in the _cg_cgid cookie
  // in a handler: req.clikgate.clickId
  ```

- **Fastify:** `await app.register(clikgatePlugin, { client: clikgate })` from `@clikgate/node/fastify`, then `request.clikgate.clickId`.
- **Next.js 16+:** in `proxy.ts`, `export { clikgateProxy as proxy } from '@clikgate/node/next'`. Then read it in a route or server component with `getClickId(await cookies())`. On Next.js 15 and older, the file is `middleware.ts`, with `export { clikgateMiddleware as middleware } from '@clikgate/node/next'`.
- **Without a framework:** `clikgate.clickIds.fromRequest(req)` and `clikgate.clickIds.persist(res, clickId)`.
- **From payment webhooks** (Paystack, Flutterwave, Shopify, WooCommerce): `clikgate.clickIds.fromPaymentMetadata(payload)`.

### Payment goals confirmed by the server

Right after the server's own verification with the gateway, either send the Payment goal with the confirmed value, `await clikgate.goals.send('order_paid', { reference, provider: Provider.Paystack, value: '7500', currency: 'NGN', clickId })` (from the server it is a trusted confirmation; `Provider` lists every gateway, and a provider key string works for a newer one), or call `await clikgate.payments.fromPaystack(verified)`, or `fromFlutterwave`, `fromMonnify` or `fromStripe`. For other gateways, use `payments.confirm({...})`. The helpers send only the reference, status, exact amount, currency and time, never the whole response. Never call them with browser or app data. See [payments.md](payments.md).

### Identify users: identity tokens (path A)

When the app calls `identifyUser()` with a customer ID, return an identity token from the server in the responses the app already calls (sign-in, and "current user" / "me" at app open). One extra field, no new endpoint, no network call. The secret is `CLIKGATE_IDENTITY_SECRET` in the server's environment only (add `CLIKGATE_IDENTITY_SECRET=` with no value to `.env.example`); for several apps, `CLIKGATE_IDENTITY_SECRETS` is a JSON object of app IDs to secrets and you pass `{ appId }`.

```ts clikgate-check
import { createIdentityToken } from '@clikgate/node';

export function signInResponse(user: { id: string; name: string }): { user: { id: string; name: string }; clikgateIdentityToken: string } {
  return { user, clikgateIdentityToken: createIdentityToken(user.id) }; // reads CLIKGATE_IDENTITY_SECRET
}
```

- `user.id` is the business's own user ID, never an email or phone number. It throws `ClikgateServerOnlyError` in a browser or React Native: never import it into app or website code.
- **Path B** (no secret or token): the app sends `getInstallationId()` with its sign-in request (skip when it is `null`), and the server calls `await clikgate.identifyUser({ appId: 'app_…', installationId, customerId: user.id })` after sign-in and at every signed-in app open.
- Guide: https://clikgate.com/docs/identify-users.

### Webhooks

```ts
import express from 'express';
import { webhooks } from '@clikgate/node';

app.post('/webhooks/clikgate', express.raw({ type: 'application/json' }), (req, res) => {
  const event = webhooks.verify(req.body, req.get('Clikgate-Signature'), process.env.CLIKGATE_WEBHOOK_SECRET!);
  res.sendStatus(200); // deliveries are at-least-once: dedupe on event.id
});
```

- Mount `express.raw` before any global `express.json()`: verification needs the exact bytes.
- In Next.js route handlers, pass `await request.text()` as the body.
- Keep the secret in `CLIKGATE_WEBHOOK_SECRET`.
- `event.type` is a plain string such as `goal.completed`, `link.destination_changed` or `subscription.updated` (a Growth add-on was activated or set to end at renewal: `data.change`, `data.add_on_key`). Ignore types you don't handle.

### Serverless and shutdown

In a serverless function, call `await clikgate.flush()` before returning, or use `new Clikgate({ sendMode: 'sync' })` with `await clikgate.goals.send(…)`.

### Private mode

The SDK reads the organisation's private-mode setting itself (`privateMode: 'auto'`, the default). When it is on, only `goal`, `clickId`, `code`, `reference`, `value`, `currency`, `provider`, `isFirst`, `occurredAt` and `consent` are sent. Anything else (`metadata`, emails, customer IDs) throws `PrivateModeFieldRejectedError` before sending. See [goals.md](goals.md).

### Links

`clikgate.links.create({ destination_url, og_title, og_image_url })`, `clikgate.links.update(id, …)` (check `result.applied`: a change can wait for a second approver), and `clikgate.links.list(…)` (async iterable; `{ metadata: { seller_id: 'sel_ada' } }` filters by the link's own metadata, sent as `metadata[seller_id]=sel_ada`, and the `api.analytics` methods take the same `metadata` filter). With a `cg_test_` key, links use `dev.ciz.to` and may only point to the destinations in [test-links.md](test-links.md).

## Other languages: the HTTP API (until their SDKs ship)

```sh
curl https://api.clikgate.com/v1/goals/events \
  -H "Authorization: Bearer $CLIKGATE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"goal": "account_opened", "click_id": "clk_…", "reference": "APP-55231", "value": "2000000", "currency": "NGN"}'
```

- `goal` and `reference` are required. Clikgate dedupes `(goal, reference)`: resending returns `200` with the stored event, so retries never count twice. Correct a goal with a reversal, not by resending it with a different body.
- Optionally send an `Idempotency-Key` header: a random UUID per call, reused on that call's retries. Never derive it from the reference (Clikgate already dedupes the reference).
- Responses give the goal status, `counted`, `waiting`, `received` or `refused` (field `status`), `reason`, `goal_kind`, which is `standard` or `payment`, and `event_status`, the attribution state,, `value` as a decimal string (normal units) and `value_minor` as an integer (minor units, e.g. kobo). Read `value` for exact amounts; never parse it as a float. Ignore fields you don't know: new ones can appear.
- A Payment goal from the server: add `"provider"` (a key from `GET /v1/payment-gateways`, e.g. `"paystack"`) and the payment reference, with the confirmed `value` (required, above 0) and `click_id` (not `code`).
- Send `value` as a decimal **string** built from the language's exact type: Python `Decimal` (`format(d, "f")`), Java `BigDecimal.toPlainString()`, .NET `decimal.ToString(CultureInfo.InvariantCulture)`, PHP strings. Never use floats.
- Retry only network errors, `429` (honour `Retry-After`), `500`, `502`, `503` and `504`. Never retry other statuses.
- `422 unknown_goal` (the organisation turned off "Allow unknown goal names" and no goal or alias has this name; live keys only) and `422 goal_archived` in that mode are final: the error envelope also carries `status: "refused"`, `reason`, `counted: false` and `goal_kind: null`. The SDKs raise their invalid-request error with that code; for `unknown_goal` they log ``Goal `{name}` isn't set up in Clikgate`` only when debug logging is on. Never check names locally or cache the setting; the fix is setting the goal up in the dashboard.
- Batches: `POST /v1/goals/events/batch` with `{"events": [...]}` (at most 500).
- Reversals (refunds, cancellations): `POST /v1/goals/events/reverse` with `{"goal", "reference", "value"?}`.
- Identity tokens (path A, no network call): `base64url_nopad(HMAC_SHA256(CLIKGATE_IDENTITY_SECRET, customerId + "." + issuedAt)) + "." + issuedAt`, with UTF-8 bytes and `issuedAt` in whole Unix seconds. Python: `base64.urlsafe_b64encode(hmac.new(secret.encode(), f"{customer_id}.{issued}".encode(), hashlib.sha256).digest()).rstrip(b"=").decode() + f".{issued}"`. Run it on the server only. Path B instead: `POST /v1/people/identify` with `{"app_id", "installation_id", "customer_id", "label"?}`.
- Webhook signatures: header `Clikgate-Signature: t=<unix seconds>,v1=<hex>`. The hex is HMAC-SHA256 with the whole secret (including `whsec_`) as the key, over `"<t>." + raw body`. Compare in constant time, and reject timestamps more than 300 s away.
