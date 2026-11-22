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
- **`goals.send()`** waits for the API and returns the result: `status` is a `GoalStatus` (`counted`, `waiting`,
  `received` or `refused`), with `reason`, `goal_kind` (`GoalKind`), `attributed_to`, … `received` means the name isn't ticked as a goal in the dashboard yet (or the goal is archived): it is stored, not counted, and shows in Measure › Seen from your app and website. Every status is a result, never an error, and none is retried. Goals work on every plan, up to the plan's allowance.

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

## End to end

One Express app that uses only the typed methods: the identity token, the installation header, goals, payments, a
webhook and a referrer.

```ts
import express from 'express';
import { Clikgate, EventType, Provider, createIdentityToken, webhooks } from '@clikgate/node';
import { clikgateMiddleware } from '@clikgate/node/express';

const clikgate = new Clikgate();                      // CLIKGATE_API_KEY
const PROGRAM_ID = 'rpg_01J…';                        // your referral program
const app = express();

// Webhooks need the raw body: register this before express.json()
app.post('/webhooks/clikgate', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = webhooks.verify(req.body, req.get('Clikgate-Signature'), process.env.CLIKGATE_WEBHOOK_SECRET!);
  const referral = event.asReferral();                // null for other event types
  if (referral && event.type === EventType.ReferralQualified) {
    const reward = referral.reward_snapshot?.referrer; // amount_minor 50000 → amount "500.00"
    await creditWallet(referral.referrer.customerId, reward?.amount, reward?.currency);
  }
  res.sendStatus(200);                                // deliveries are at-least-once: dedupe on event.id
});

app.use(express.json(), clikgateMiddleware(clikgate));

app.post('/login', async (req, res) => {
  const user = await signIn(req.body);                // your own sign-in check first
  // Path B: the app's Clikgate-Installation header; the customer ID is always your signed-in user
  if (req.clikgate.installation) await clikgate.identifyUser({ installation: req.clikgate.installation, customerId: user.id });
  // Path A: an identity token the app passes to the mobile SDK
  const referrer = await clikgate.referrals.getOrCreateReferrer(PROGRAM_ID, { customerId: user.id, displayName: user.firstName });
  res.json({ user, clikgateIdentityToken: createIdentityToken(user.id), referralCode: referrer.code, referralUrl: referrer.url });
});

app.post('/accounts', async (req, res) => {
  const account = await openAccount(req.body);
  clikgate.goal('account_opened', { clickId: req.clikgate.clickId, reference: account.id });   // never throws
  res.json(account);
});

app.post('/orders/:ref/verify', async (req, res) => {
  const verified = await paystack.verify(req.params.ref);   // your own verification with the gateway
  await clikgate.payments.fromPaystack(verified, { goal: 'order_paid' });
  // or: await clikgate.goals.send('order_paid', { reference: req.params.ref, provider: Provider.Paystack, value: '7500', currency: 'NGN' });
  res.sendStatus(204);
});
```

## Identify your users

Two ways to tell Clikgate which of your users is using the app. Full guide: https://clikgate.com/docs/identify-users. The customer ID is your own user ID from your database, never an email, phone number or ID number. Anonymous users don't need either path.

**Path A (default): identity token.** Create the identity secret in Developers › SDKs › your app › Set up identity › Identity secret and store it as `CLIKGATE_IDENTITY_SECRET` on your server only. `createIdentityToken(customerId, { appId? })` (also `clikgate.createIdentityToken()`, with the `identitySecret` / `identitySecrets` options) signs a token with no network call; return it in the responses the app already calls, and the app passes it to the mobile SDK's `identifyUser()`. Tokens last 30 days by default and are never force-refreshed. Throws `ClikgateServerOnlyError` in a browser or React Native.

```ts
import { createIdentityToken } from '@clikgate/node';
// sign-in and "current user" responses: one extra field
res.json({ user, clikgateIdentityToken: createIdentityToken(user.id) });   // reads CLIKGATE_IDENTITY_SECRET
createIdentityToken(user.id, { appId: 'app_…' });                          // several apps: CLIKGATE_IDENTITY_SECRETS
```

**Path B: the installation header, no secret or token.** The mobile SDK gives your app a `Clikgate-Installation` header (`<app_id>:<installation_id>`, not a secret), which the app sends to your server with its sign-in request and signed-in requests. After your own sign-in check succeeds, and at every signed-in app open, pass it to `identifyUser` with your signed-in user's ID. Your server never needs to know which Clikgate app ID belongs to which platform. Clikgate accepts installations active in the last 7 days.

- **The customer ID always comes from your own authenticated user.** The header only names the app installation. Call `identifyUser` only after your sign-in check succeeds, and never read the customer ID from the request.
- **A missing or invalid header is ignored** (`null`, never an error or a log line): skip the call. Parsing is strict: `app_…`, one colon, a lowercase UUID, at most 128 characters, trimmed.
- **`appId` is optional.** With only an installation ID, Clikgate finds the app. If the same installation ID is active in several of your apps (iOS apps sharing a Keychain access group can share one), the API answers `409 installation_in_several_apps`, a `ConflictError` with param `app_id`: send `appId` too.

```ts
import { clikgateMiddleware } from '@clikgate/node/express';
app.use(clikgateMiddleware(clikgate));                // also reads the Clikgate-Installation header
app.post('/login', async (req, res) => {
  const user = await signIn(req.body);                // your own sign-in check first
  if (req.clikgate.installation) {
    await clikgate.identifyUser({ installation: req.clikgate.installation, customerId: user.id });   // the parsed installation
  }
});

// Without the middleware: pass the raw header value (ignored when missing or invalid)
await clikgate.identifyUser({ installation: req.get('Clikgate-Installation'), customerId: user.id });
// Or parse it yourself: { appId, installationId } or null
const installation = parseInstallationHeader(req.get('Clikgate-Installation'));
```

## Customers from before Clikgate

Tell Clikgate who was already your customer before you added it, so they are never counted as a referral or a new customer. Send the account's creation date with the identity token (version 2) or from your server, and import the rest of your existing customers once. Use your own customer IDs, never emails or phone numbers: Clikgate stores a keyed fingerprint of each imported ID, not the ID itself. Not available in private mode. Guide: https://clikgate.com/docs/identify-users.

```ts
res.json({ user, clikgateIdentityToken: createIdentityToken(user.id, { customerSince: user.createdAt }) }); // version 2
await clikgate.identifyUser({ installation: req.get('Clikgate-Installation'), customerId: user.id, customerSince: user.createdAt });
const result = await clikgate.knownCustomers.import([{ customerId: 'u_10482', customerSince: '2024-03-02' }]); // batches of 10,000
console.log(result.accepted, result.refused_by_reason); // refused rows are counted by reason, never returned
```

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
- **The app's installation** (`Clikgate-Installation` header, for `identifyUser`): Express `req.clikgate.installation`, Fastify `request.clikgate.installation`, Next.js `getInstallation(await headers())` from `@clikgate/node/next`, and without a framework `installationFromRequest(req)` or `parseInstallationHeader(value)`. Each is `{ appId, installationId }` or `null`, and can be passed to `identifyUser` as `installation`, like the raw header.
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

- Typed accessors read `event.data.object`: `asReferral()` (`referral.*`), `asReferrer()` (`referrer.*`),
  `asGoalEvent()` (`goal.completed`, `goal.reversed`), `asInstall()` (`install.*`), `asPayment()` (`payment.*`) and
  `asConversion()` (`conversion.*`) and `asDeviceChange()` (`person.device_changed`). Each returns `null` for an event of another family, so the same handler can take
  every event. `event.data` stays the raw payload.
- `EventType` holds every event type as a string (`EventType.ReferralQualified === 'referral.qualified'`); `event.type`
  stays a plain string, so a type added later is never an error. `event.typed()` gives the same event as a union
  narrowed by `type`.
- Use `webhooks.verifyAny(body, header, [newSecret, oldSecret])` while you rotate your own secrets.
- Next.js route handlers: pass `await request.text()` as the body.

## Serverless

In a serverless function, call `await clikgate.flush()` before returning. Alternatively use `new Clikgate({ sendMode: 'sync' })` with `await clikgate.goals.send(…)`.

## Private mode

- With `privateMode: 'auto'` (the default), the SDK reads your organisation's setting from `GET /v1/server-sdk/config` and caches it for 10 minutes.
- When private mode is on, only `goal`, `clickId`, `code`, `reference`, `value`, `currency`, `provider`, `isFirst`, `occurredAt`, `consent`, `keptBy`, `browserEngine` and `platform` are sent, plus `label` (the API accepts it only when an Owner allows labels in private mode) and the three hashed identifiers (accepted only while an ad network destination matches by hashed email or phone). Anything else (`metadata`, emails, customer IDs, …) is refused **before sending** with `PrivateModeFieldRejectedError`, which names the field, never its value.
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
- `links.create` and `links.update` take `LinkCreateParams` / `LinkUpdateParams` (the API's fields, typed); plain
  objects still work. `Link` has every field of the API's link.
- `links.archive(id)`, `links.pause(id)`, `links.resume(id)` and `links.getByReference('order-1001')` return the link.

## Referrals

```ts
const referrer = await clikgate.referrals.getOrCreateReferrer(programId, { customerId: user.id, displayName: user.firstName });
referrer.code; referrer.url; referrer.created;          // created: true when it was just made
const existing = await clikgate.referrals.findReferrer(programId, { code: 'ADA42' });   // null when there is none

for await (const referral of clikgate.referrals.list({ programId, status: 'qualified' })) {
  console.log(referral.referee.customerId, referral.reward_snapshot?.referrer?.amount);
}
await clikgate.referrals.completeStep(referralId, { goal: 'first_order', occurredAt: order.paidAt, value: '1500.50', currency: 'NGN' });
await clikgate.referrals.qualify(referralId, { reason: 'Checked by support' });         // or disqualify
const jobs = await clikgate.referrals.importReferrers(programId, [{ customerId: 'user-42', externalCode: 'ADA-OLD' }]);
await clikgate.referrals.blockReferrer(referrer.id, { reason: 'Fake installs' });       // unblockReferrer, updateReferrer
```

- `getOrCreateReferrer` options: `code` is your own Clikgate code for a new referrer instead of a generated one. It is
  3-32 letters, digits, `-` or `_`, stored as you send it, and unique in your organisation ignoring case. A code
  that is taken is a `ConflictError` (`409 code_taken`); a bad format is an `InvalidRequestError` (`422 invalid_code`),
  and so is a code that ends in a hyphen and one letter, such as `ADA-w`, which is kept for share links (`422 reserved_link_ending`). `externalCode` (2-64 characters)
  is an extra code from an older referral system that keeps working alongside the Clikgate code. Both apply only when
  the referrer is created: an existing referrer is returned unchanged. `updateReferrer(id, { externalCode })`
  replaces the extra code later; the Clikgate `code` can't be changed.
- Results are typed (`Referrer`, `Referral`, `RewardInfo`, `Job`) with the API's keys. The SDK adds `customerId` next
  to `customer_user_id` on referrers and on a referral's `referrer` and `referee`.
- Reward sides keep `amount_minor` (minor units) and gain `amount`, the same value in normal units as a decimal string
  with the currency's digits (`50000` NGN is `"500.00"`, `1500` JPY is `"1500"`). Clikgate never pays rewards.
- `importReferrers` sends 1000 rows per request and returns one job per request.

## Privacy, people, installs and codes

```ts
await clikgate.privacy.createRequest({ type: 'erasure', subjectType: 'customer_user', subjectId: user.id });
const person = await clikgate.people.get('per_01J…');
for await (const p of clikgate.people.search('Ada')) console.log(p.id, p.label);       // the text is sent in the body
await clikgate.people.setLabel(person.id, 'Ada (VIP)');
const install = await clikgate.installs.getByCustomer(user.id, { appId: 'app_01J…' });  // or getByInstallation
const redemption = await clikgate.codes.redeem({ externalId: 'POS-991', code: 'ADA42', channel: 'pos', agentId: 'agent-9' });
```

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
| `baseUrl` | `CLIKGATE_BASE_URL`, else `https://api.clikgate.com` |
| `timeout` | 10 000 ms |
| `maxRetries` | 3 |
| `sendMode` | `'background'` (or `'sync'`) |
| `privateMode` | `'auto'` |
| `clickIdParam` | from config, else `cgid` |
| `logger` | `console`, warnings and errors only |
| `onError` | — (background failures) |
| `httpClient` | built-in (a `fetch`-compatible function for mTLS or tracing) |
| `proxy` | `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` (or an explicit URL, or `false`) |
| `batchSize` / `flushInterval` / `maxQueueSize` | 100 / 1000 ms / 10 000 |
| `shutdownHooks` | `true` |

## Everything else

`clikgate.api.<resource>.<operation>()` covers every API-key operation, generated from the OpenAPI spec (for example `clikgate.api.campaigns.listCampaigns()`). It uses the same transport, retries and errors.

The behaviour of all five Clikgate server SDKs is defined in [`server/SPEC.md`](https://github.com/clikgate/clikgate-sdks/blob/main/server/SPEC.md) and checked by the shared conformance suite.

## Development

```bash
npm ci
npm run lint && npm run typecheck && npm run typecheck:examples
npm test                 # unit tests + the conformance suite against the local mock server
npm run build            # dist/esm, dist/cjs (+ .d.ts)
npm run check:package    # exports resolve from import and require, and the tarball is clean
npm run generate         # regenerate src/generated from server/openapi (needs Java 11+)
```

Licence: MIT. Security: report vulnerabilities to support@clikgate.com; see the [trust centre](https://clikgate.com/trust).
