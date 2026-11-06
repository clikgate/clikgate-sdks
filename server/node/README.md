# @clikgate/node

The official Clikgate server SDK for Node.js and TypeScript. It:

- sends goals in three lines;
- keeps the click ID;
- verifies webhooks;
- has private mode built in.

It has zero runtime dependencies and supports Node 18+, with ESM, CommonJS and TypeScript types.

```bash
npm install @clikgate/node
```

```ts
import { Clikgate } from '@clikgate/node';
const clikgate = new Clikgate();                       // reads CLIKGATE_API_KEY (cg_live_… or cg_test_…)
clikgate.goal('account_opened', { clickId, reference: 'APP-55231', value: '2000000' });
```

Create one client and reuse it. `goal()` is the one method for every goal, Standard or Payment.

- **`goal()`** never throws. It queues the event and sends it in the background, in batches, with safe retries.
- **`goals.send()`** waits for the API and returns the result: `status` is a `GoalStatus` (`counted`, `waiting` or
  `refused`), with `reason`, `goal_kind` (`GoalKind`), `attributed_to`, …

```ts
import { GoalStatus } from '@clikgate/node';
const event = await clikgate.goals.send('account_opened', { clickId, reference: 'APP-55231' });
if (event.status === GoalStatus.Refused) console.log('not counted:', event.reason);   // e.g. rejected_bot
```


### Match by hashed email or phone (ad networks)

When the business has turned on matching by hashed email or phone for an ad network destination, a goal can carry your own SHA-256 hashes: `hashedEmail`, `hashedPhoneE164` and `hashedPhoneDigits` (sent as `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`). `hashForAds` makes them on your server (offline, no client needed) and returns only the fields for the values you give:

```ts
import { hashForAds } from '@clikgate/node';

clikgate.goal('account_opened', {
  reference: 'APP-55231',
  clickId,
  ...hashForAds({ email: 'ada.obi@example.com', phone: '+234 803 123 4567' }),
});
```

The email is trimmed and lowercased. The phone must include its country code (`+234…` or `00234…`); a national number such as `0803 123 4567` is an `InvalidRequestError` (`invalid_argument`), and the SDK never guesses the country. A hashed value that isn't 64 lowercase hex characters is refused before sending (`invalid_hashed_identifier`). `conversions.create` takes the same wire fields. Hashed values are never logged.

In private mode, hash on your own server: Clikgate never hashes for you there.

## People: identify a user and label them

Link a click, an app installation or your customer ID to a person, and give them a label your team sees instead of the click ID (1-80 characters; Growth and up). From your server this is always verified. Goals take the same `label`, and `isFirst` from your server is what counts a new customer. Don't put information in labels that your customers wouldn't expect you to keep.

```ts
await clikgate.identifyUser({ clickId: order.clickId, customerId: 'user_42', label: 'Ada (VIP)' });
clikgate.goal('account_opened', { clickId, reference: 'APP-55231', isFirst: true, label: 'Ada (VIP)' });
```

## Keep the click ID

The pattern is: capture it on landing, save it with your own record, then send the goal later from any job.

```ts
import express from 'express';
import { clikgateMiddleware } from '@clikgate/node/express';

app.use(clikgateMiddleware(clikgate));      // keeps ?cgid=… in the _cg_cgid cookie (the web script's cookie)
app.post('/signup', (req, res) => {
  db.applications.insert({ id: 'APP-55231', clickId: req.clikgate.clickId });
});

// days later, when the account is approved:
clikgate.goal('account_opened', { clickId: application.clickId, reference: application.id, value: '2000000', currency: 'NGN' });
```

- **Fastify:** `await app.register(clikgatePlugin, { client: clikgate })` from `@clikgate/node/fastify`, then read `request.clikgate.clickId`.
- **Next.js 16+:** in `proxy.ts`, `export { clikgateProxy as proxy } from '@clikgate/node/next'`. Then read it with `getClickId(await cookies())`.
- **Without a framework:** `clikgate.clickIds.fromRequest(req)` and `clikgate.clickIds.persist(res, clickId)`.
- **From payment payloads** (Paystack, Flutterwave, Shopify, WooCommerce): `clikgate.clickIds.fromPaymentMetadata(payload)`.

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

Add a `/cg/keep` route to your server and tell the web script about it with `data-server-endpoint="/cg/keep"`. When a click ID arrives in the page URL, the script makes one `POST` to that route, and your server sets the `_cg_<param>` cookie (30 days by default, `days` up to 400) plus a small `_cg_kept=s` marker, so goals report `keptBy: 'server_cookie'`.

- **Same server:** the route must be served by the same host as the website (the page's own origin, e.g. `https://shop.example.com/cg/keep`), not by another domain or subdomain. A cookie set by another host doesn't get the longer lifetime.
- **Readable by the page on purpose:** both cookies are not `HttpOnly`, because the web script reads them. They are `SameSite=Lax` and `Secure` (default `true` here; pass `secure: false` only for local `http://` development).
- **Locked down:** only a same-origin `POST` (`Sec-Fetch-Site: same-origin`, or an `Origin` equal to the request's host) with a valid click ID that matches the page URL's is accepted. Every answer is `Cache-Control: no-store, private` with an empty body; it never redirects, and the input is never echoed or logged. The cookie name comes from your configuration (`clickIdParam`, else `cgid`), never from the request.

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_live_…" data-server-endpoint="/cg/keep" async></script>
```

**Next.js (App Router):**

```ts
// app/cg/keep/route.ts
import { clikgate } from '@/lib/clikgate';
export const POST = clikgate.clickIds.keepRoute();            // or keepRoute({ days: 90 })

// proxy.ts (Next.js 16+; middleware.ts before): also keeps ?cgid=… from the query on any page
export { clikgateProxy as proxy } from '@clikgate/node/next';
export const config = { matcher: ['/((?!_next/|api/webhooks/).*)'] };
```

Without a client, `import { keepRoute } from '@clikgate/node/next'` and `export const POST = keepRoute()` uses the same parameter as the proxy (`clickIdParam`, else `CLIKGATE_CLICK_ID_PARAM`, else `cgid`).

**Express / Connect** (`app.all` so other methods get the route's own `405`; before or after `express.json()`, both work):

```ts
app.all('/cg/keep', clikgate.clickIds.keepRoute({ days: 90 }).express);
```

**Plain `node:http`:** `route.node(req, res)`. Any other framework: `route.handle({ method, headers, readBody })` returns `{ status, headers }`.

Then send what you know about how it was kept with the goal. `clickIds.context(req)` returns `{ clickId, keptBy, browserEngine, platform }`; the engine and platform are worked out from the `User-Agent` in the SDK (the User-Agent itself is never sent), and all three are allowed in private mode:

```ts
clikgate.goal('account_opened', { reference: application.id, ...clikgate.clickIds.context(req) });
```

`keptBy` is `server_cookie` (your server set the cookie), `script_cookie` (the web script did), `form` (the `Clikgate-Click-Id` header) or `null`; you can also pass `'payment_metadata'` or `'unknown'` yourself. `persist()` and the framework add-ons also write the `_cg_kept=s` marker.

## Money

- `value` is in **normal units** (₦2,000,000 is `'2000000'`, never kobo) and is always sent as a decimal string.
- It accepts a `string`, a `number` or a `bigint`. Pass strings like `'1500.50'` for exact values. A number with decimals works, but logs an `inexact_number` warning.

## Payment goals

A goal is **Standard** or **Payment** (`GoalKind.Standard` / `GoalKind.Payment`, set in the goal's settings in the
dashboard, never in the call). A Payment goal counts only when a trusted source confirms it, with the confirmed amount:

1. Your website or app **reports** it with the same `goal()` call, with `provider` and `reference` (never an amount).
   The result is `waiting` until the payment is confirmed.
2. Your server **confirms** it, right after its own verification with the gateway, in one of two ways:
   - send the Payment goal with the confirmed value: it is a trusted confirmation;
   - or pass the gateway's verified response to a helper below.

```ts
import { Provider } from '@clikgate/node';
// after your own verification with Paystack:
await clikgate.goals.send('order_paid', { reference: 'T123456', provider: Provider.Paystack, value: '7500', currency: 'NGN', clickId });
```

- `provider` is a `Provider` (every gateway in `GET /v1/payment-gateways`, plus `shopify`, `woocommerce` and
  `custom`). A provider key string works too, for a gateway added after your SDK release.
- `provider` and `reference` are required on a Payment goal (`422 payment_goal_needs_confirmation`, with `missing`,
  otherwise): the SDK can't check this itself, because the kind lives only in the goal's settings.
- With a `clickId` the goal counts at once. Without one, it is `waiting` until the website's or app's report arrives.
- A Payment goal needs a Starter plan or above (`PermissionError` `plan_feature_unavailable` on Free).

The helpers read the gateway's verified response. Call them **right after your own server has verified the payment
with the gateway**. Never pass data from the browser or the app. A helper sends only the reference, status, amount,
currency, time and `cg_click_id`. It never sends customer details, and it never needs your gateway key.

```ts
// Paystack: after your own GET /transaction/verify/{reference}
await clikgate.payments.fromPaystack(verifyResponse, { goal: 'order_paid' });
// Flutterwave: after your own GET /v3/transactions/{id}/verify
await clikgate.payments.fromFlutterwave(verifyResponse);
// Monnify: after your own GET /api/v2/transactions/{transactionReference}
await clikgate.payments.fromMonnify(statusResponse);
// Stripe: a PaymentIntent you retrieved, or the Checkout Session from a webhook you verified
await clikgate.payments.fromStripe(paymentIntent);

// Any other gateway, or a refund:
await clikgate.payments.confirm({ provider: Provider.Paystack, reference: 'T_ref_001', status: 'refunded', amount: '2500.00', currency: 'NGN' });
```

- Amounts are exact decimals, never floats: Paystack's `750000` kobo becomes `"7500"`.
- The helpers return `null` (and send nothing) when the response has no reference or no known status.
  `buildFromPaystack(...)` and the other builders return the body without sending it.
- Private mode allows every field these send.

## Webhooks

```ts
import { webhooks } from '@clikgate/node';
app.post('/webhooks/clikgate', express.raw({ type: 'application/json' }), (req, res) => {
  const event = webhooks.verify(req.body, req.get('Clikgate-Signature'), process.env.CLIKGATE_WEBHOOK_SECRET!);
  res.sendStatus(200);   // deliveries are at-least-once: dedupe on event.id
});
```

- Use `webhooks.verifyAny(body, header, [newSecret, oldSecret])` while you rotate your own secrets.
- Next.js route handlers: pass `await request.text()` as the body.

## Serverless

In a serverless function, call `await clikgate.flush()` before returning. Alternatively use `new Clikgate({ sendMode: 'sync' })` with `await clikgate.goals.send(…)`.

## Private mode

- With `privateMode: 'auto'` (the default), the SDK reads your organisation's setting from `GET /v1/server-sdk/config` and caches it for 10 minutes.
- When private mode is on, only `goal`, `clickId`, `code`, `reference`, `value`, `currency`, `provider`, `isFirst`, `occurredAt` and `consent` are sent. Anything else (`metadata`, emails, customer IDs, …) is refused **before sending** with `PrivateModeFieldRejectedError`, which names the field, never its value.
- References are redacted in logs.
- If the setting can't be loaded, the SDK assumes private mode is on.

## Links

```ts
const link = await clikgate.links.create({ destination_url: 'https://example.com/spring', og_title: 'Spring sale', og_image_url: 'https://example.com/og.png' });
link.warnings;          // e.g. [{ code: 'no_preview', … }]
link.domain_badge;      // 'premium' on ciz.to links

const result = await clikgate.links.update(link.id, { destination_url: 'https://example.com/summer' });
if (!result.applied) console.log('waiting for a second approver:', result.change_request.id);

for await (const l of clikgate.links.list({ status: 'active' })) console.log(l.short_url);

// Filter by your own link metadata (sent as metadata[seller_id]=sel_ada); analytics take it too.
for await (const l of clikgate.links.list({ metadata: { seller_id: 'sel_ada' } })) console.log(l.metadata);
const ada = await clikgate.api.analytics.analyticsSummary({ from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', metadata: { seller_id: 'sel_ada' } });
```

- With a `cg_test_` key, links use `dev.ciz.to`. Their destination may be one of Clikgate's test pages: `clikgate-test:inspect`, `clikgate-test:checkout`, `clikgate-test:app-open` or `clikgate-test:store`.
- A locked link throws `LinkLockedError`.

## Errors

Every error extends `ClikgateError`, with `code`, `httpStatus`, `requestId` and `param`:

| Error | When |
|---|---|
| `AuthenticationError` | 401 |
| `PermissionError` | 403: `plan_limit_reached` and `plan_feature_unavailable` (`requiredPlan`), `test_link_limit_reached` (`limit`), `cli_scope`, … |
| `InvalidRequestError` | 4xx and local validation: `invalid_value`, `invalid_provider`, `unknown_provider`, `domain_mode_mismatch`, `test_destination_not_allowed` (`allowed`, `docUrl`), … |
| `PrivateModeFieldRejectedError` | private mode refused a field (`field`) |
| `NotFoundError` | 404 |
| `ConflictError` / `LinkLockedError` | 409 |
| `IdempotencyError` | 409 `idempotency_*` |
| `RateLimitError` | 429, with `retryAfter` |
| `ServerError` | 5xx |
| `NetworkError` / `TimeoutError` | the connection failed, or timed out |
| `SignatureVerificationError` | webhook verification failed |
| `ConfigurationError` | thrown by the constructor |

- **Retries:** network errors, timeouts and HTTP 429, 500, 502, 503 and 504 are retried up to `maxRetries` (default 3), with full-jitter backoff and `Retry-After`.
- **No double counting:** each goal call sends a random `Idempotency-Key`, reused across its retries, and the API ignores a second event with the same goal and reference, so a retry or a resend never counts twice.

## Options

| Option | Default |
|---|---|
| `apiKey` | `CLIKGATE_API_KEY` |
| `baseUrl` | `https://api.clikgate.com` |
| `timeout` | 10 000 ms |
| `maxRetries` | 3 |
| `sendMode` | `'background'` (or `'sync'`) |
| `privateMode` | `'auto'` |
| `clickIdParam` | from config, else `cgid` |
| `logger` | `console`, warnings and errors only |
| `onError` | — (background failures) |
| `httpClient` | built-in (a `fetch`-compatible function for mTLS or tracing) |
| `proxy` | `HTTPS_PROXY` / `NO_PROXY` (or an explicit URL, or `false`) |
| `batchSize` / `flushInterval` / `maxQueueSize` | 100 / 1000 ms / 10 000 |
| `shutdownHooks` | `true` |

## Everything else

`clikgate.api.<resource>.<operation>()` covers every API-key operation, generated from the OpenAPI spec (for example `clikgate.api.campaigns.listCampaigns()`). It uses the same transport, retries and errors.

The behaviour of all five Clikgate server SDKs is defined in [`server/SPEC.md`](../SPEC.md) and checked by the shared conformance suite.

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm run typecheck:examples
npm test                 # unit tests + the conformance suite against the local mock server
npm run build            # dist/esm, dist/cjs (+ .d.ts)
npm run check:package    # exports resolve from import and require, and the tarball is clean
npm run generate         # regenerate src/generated from server/openapi (needs Java 11+)
```

Licence: MIT. Security: see [SECURITY.md](SECURITY.md).
