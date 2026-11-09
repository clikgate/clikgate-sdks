# clikgate/clikgate-php

The official Clikgate server SDK for PHP. It:

- sends goals in three lines;
- keeps the click ID;
- verifies webhooks;
- has private mode built in.

It supports PHP 8.1+ and depends only on PSR interfaces and `php-http/discovery`. It sends with ext-curl when available, or with any PSR-18 client.

```bash
composer require clikgate/clikgate-php
```

```php
$clikgate = new \Clikgate\Clikgate();      // reads CLIKGATE_API_KEY (cg_live_… or cg_test_…)
$clikgate->goal('account_opened', ['clickId' => $clickId, 'reference' => 'APP-55231', 'value' => '2000000']);
```

Laravel: `composer require clikgate/clikgate-laravel` (provider, facade, `clikgate` middleware and queued sending). See its README.

- **`goal()`** is the one method for goals and payments. It never throws: failures go to the logger and `onError`.
- **`goals->send()`** waits for the API and returns the result (the wire JSON as an array): `status` is a `GoalStatus` value, `counted`, `waiting`, `received` or `refused` (with `reason`), plus `goal_kind`, `attributed_to`, … `received` means the name isn't ticked as a goal in the dashboard yet (or the goal is archived): it is stored, not counted, and shows in "Seen from your app and website". Every status is a result, never an error, and none is retried. Goals work on every plan, up to the plan's allowance.

```php
use Clikgate\Enum\GoalKind;
use Clikgate\Enum\GoalStatus;
use Clikgate\Enum\Provider;

$event = $clikgate->goals->send('order_paid', ['reference' => 'T123456', 'value' => '7500', 'currency' => 'NGN', 'provider' => Provider::Paystack, 'clickId' => $clickId]);
$status = GoalStatus::tryFrom($event['status']);       // null for a status this release doesn't know
if (GoalStatus::Waiting === $status && GoalKind::Payment === GoalKind::tryFrom($event['goal_kind'] ?? '')) {
    // a Payment goal waiting for its confirmation
}
```

`GoalKind`, `GoalStatus` and `Provider` are backed enums generated from the API. `provider` also takes a provider-key string (`'acme_pay'`) for a gateway added after this release.


### Match by hashed email or phone (ad networks)

When the business has turned on matching by hashed email or phone for an ad network destination, a goal can carry your own SHA-256 hashes: the options `hashedEmail`, `hashedPhoneE164` and `hashedPhoneDigits` (wire `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`). `HashForAds::hash()` makes them on your server (offline, no client needed) and returns only the options for the values you give, ready to add to the options of `goal()` or `goals->send()`:

```php
use Clikgate\HashForAds;

$clikgate->goal('account_opened', [
    'reference' => 'APP-55231',
    'clickId' => $clickId,
] + HashForAds::hash('ada.obi@example.com', '+234 803 123 4567'));
```

The email is trimmed and lowercased. The phone must include its country code (`+234…` or `00234…`); a national number such as `0803 123 4567` is an `InvalidRequestException` (`invalid_argument`), and the SDK never guesses the country. A hashed value that isn't 64 lowercase hex characters is refused before sending (`invalid_hashed_identifier`). `conversions->create()` takes the same wire fields. Hashed values are never logged.

In private mode, hash on your own server: Clikgate never hashes for you there.

## Identify your users

Two ways to tell Clikgate which of your users is using the app. Full guide: https://clikgate.com/docs/identify-users. The customer ID is your own user ID from your database, never an email, phone number or ID number. Anonymous users don't need either path.

**Path A (default): identity token.** Create the identity secret in Apps › your app › Identity secret and store it as `CLIKGATE_IDENTITY_SECRET` on your server only. `IdentityToken::create($customerId, ['appId' => …])` (also `$clikgate->createIdentityToken()`, with the `identitySecret` / `identitySecrets` options) signs a token with no network call; return it in the responses the app already calls, and the app passes it to the mobile SDK's `identifyUser()`. Tokens last 30 days by default and are never force-refreshed. Throws PHP has no browser or mobile build, so there is nothing to refuse.

```php
use Clikgate\IdentityToken;
// sign-in and "current user" responses: one extra field
return ['user' => $user, 'clikgateIdentityToken' => IdentityToken::create((string) $user->id)];   // reads CLIKGATE_IDENTITY_SECRET
IdentityToken::create((string) $user->id, ['appId' => 'app_…']);                                  // several apps: CLIKGATE_IDENTITY_SECRETS
```

**Path B: installation ID, no secret or token.** The app reads `getInstallationId()` and includes it in its sign-in request; your server calls `identifyUser` with the app ID, installation ID and customer ID, after sign-in and at every signed-in app open. Clikgate accepts installations active in the last 7 days.

```php
// The app sends Clikgate.getInstallationId() with its sign-in request (null when tracking is off: skip)
if ($installationId !== null) {
    $clikgate->identifyUser(['appId' => 'app_…', 'installationId' => $installationId, 'customerId' => (string) $user->id]);
}
```

## People: identify a user and label them

Link a click, an app installation or your customer ID to a person, and give them a label your team sees instead of the click ID (1-80 characters; Growth and up). From your server this is always verified. Goals take the same `label`, and `isFirst` from your server is what counts a new customer. Don't put information in labels that your customers wouldn't expect you to keep.

```php
$clikgate->identifyUser(['clickId' => $order->clickId, 'customerId' => 'user_42', 'label' => 'Ada (VIP)']);
$clikgate->goal('account_opened', ['clickId' => $clickId, 'reference' => 'APP-55231', 'isFirst' => true, 'label' => 'Ada (VIP)']);
```

## Sending modes

| `sendMode` | What `goal()` does |
|---|---|
| `sync` (default) | Sends one request and waits (timeout 3 s per attempt, retried safely). |
| `after_response` | Collects events and sends them after `fastcgi_finish_request()` (PHP-FPM), else at shutdown, so the visitor never waits. |
| `background` | Queues events and sends a batch every `batchSize` events, on `flush()` and at shutdown. |

With Laravel, `CLIKGATE_QUEUE=redis` sends each goal from a queued job (recommended).

## Keep the click ID

The pattern is: capture it on landing, save it with your own record, then send the goal later from any job.

```php
$clickId = $clikgate->clickIds->fromRequest($request);   // PSR-7, Symfony/Laravel, or null for the current request
saveApplication('APP-55231', $clickId);

// days later, when the account is approved:
$clikgate->goal('account_opened', ['clickId' => $application['click_id'], 'reference' => 'APP-55231', 'value' => '2000000', 'currency' => 'NGN']);
```

- **PSR-15** (Slim, Mezzio, …): `new \Clikgate\Psr15\ClikgateMiddleware($clikgate)` sets the request attribute `clikgate.click_id` and keeps a `?cgid=…` in the first-party `_cg_cgid` cookie (needs `psr/http-server-middleware`).
- **By hand:** `$response = $clikgate->clickIds->persist($response, $clickId, ['request' => $request])`. PSR-7 responses are immutable, so use the returned one.
- **From payment payloads** (Paystack, Flutterwave, Shopify, WooCommerce): `$clikgate->clickIds->fromPaymentMetadata($payload)`.

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

Two things make your server save it:

1. **Persist it from the query** when a visitor lands with `?cgid=…`: `ClikgateMiddleware` above does it, or `persist()` by hand. Both also set the `_cg_kept=s` marker, so goals report `kept_by: server_cookie`.
2. **The `/cg/keep` route** for pages your server doesn't render itself (a static or cached landing page): add `data-server-endpoint="/cg/keep"` to the web script, and the script posts the click ID from the page URL to that route once.

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_test_…" data-server-endpoint="/cg/keep" async></script>
```

```php
// Slim 4 (any PSR-15 stack): persist from the query on every page, and serve /cg/keep
$app->add(new \Clikgate\Psr15\ClikgateMiddleware($clikgate, ['days' => 90]));
$app->any('/cg/keep', $clikgate->clickIds->keepRoute(['days' => 90])); // POST only; it answers 405 itself
```

- **Same server only.** The route must be served by the same host as the website (same scheme, host and port), because the cookie is first-party. It accepts only a same-origin `POST` (`Sec-Fetch-Site: same-origin`, else an `Origin` equal to the host), a JSON body of at most 1 KB with the same valid click ID in `click_id` and `page_click_id`, and answers `204` with `Cache-Control: no-store, private`. It never redirects and never echoes or logs what it receives.
- **The cookie name comes from your configuration** (`clickIdParam`, else `cgid`), never from the request. `days` is 1 to 400 (default 30); `Secure` is on unless you pass `'secure' => false`.
- **The cookie is readable by the page on purpose** (not `HttpOnly`): the web script needs to read it. It only holds the click ID.
- **Without PSR-15:** `$clikgate->clickIds->keepRouteCore(['days' => 90])->respond($method, $headers, $rawBody)` returns `['status' => …, 'headers' => [[name, value], …]]` to send yourself.
- **Visitor context for goals:** `$clikgate->clickIds->context($request)` returns `clickId`, `keptBy` (`server_cookie`, `script_cookie`, `form` or null), `browserEngine` and `platform`. The SDK reads the `User-Agent` to work these out; the User-Agent itself is never sent. Spread it into the goal options: `$clikgate->goal('account_opened', ['reference' => 'APP-55231', ...$clikgate->clickIds->context($request)])`. These three fields are allowed in private mode.

## Money

- `value` is in **normal units** (₦2,000,000 is `'2000000'`, never kobo) and is always sent as a decimal string.
- It accepts a `string` or an `int`. A `float` throws `\InvalidArgumentException`, because floats can't hold exact amounts.

## Payment goals

A goal is **Standard** or **Payment** (`GoalKind`), set in the goal's settings, never in the call. A Payment goal counts only when a trusted source confirms it:

- Your website or app *reports* the payment with `goal()` on the Payment goal, with `provider` and `reference` (never an amount). It waits for the confirmation (`status: waiting`).
- Your server *confirms* it, **right after your own verification with the gateway**: with the helpers below, or by sending the same Payment goal with the confirmed value, `$clikgate->goals->send('order_paid', ['reference' => 'T123456', 'value' => '7500', 'currency' => 'NGN', 'provider' => Provider::Paystack])`. It is counted at once with a `clickId`, and otherwise waits for the report.

Clikgate counts the goal with the confirmed amount. The SDK never calls a gateway and never takes a gateway key. Never pass data that came from the browser or the app.

```php
// Paystack: after your own GET https://api.paystack.co/transaction/verify/{reference}
$verify = json_decode($paystackBody, true);
if ('success' === ($verify['data']['status'] ?? null)) {
    // ...fulfil the order...
    $clikgate->payments->fromPaystack($verify, ['goal' => 'order_paid']);
}

// Flutterwave: after your own GET /v3/transactions/{id}/verify
$clikgate->payments->fromFlutterwave($flutterwaveVerifyBody);

// Monnify: after your own GET /api/v2/transactions/{transactionReference}
$clikgate->payments->fromMonnify($monnifyStatusBody);

// Stripe: a PaymentIntent you retrieved, or the Checkout Session from a webhook you verified
$clikgate->payments->fromStripe($stripe->paymentIntents->retrieve($id)->toArray());

// Any other gateway, or a refund: the generic call
$clikgate->payments->confirm(['provider' => Provider::Paystack, 'reference' => 'T_ref_001', 'status' => 'refunded', 'amount' => '2500', 'currency' => 'NGN']);
```

- The helpers read only the reference, status, amount, currency, time, test flag and `cg_click_id` metadata. They never read or send customer details or the whole response. The response can be the decoded array or the raw JSON text; JSON text keeps every digit exact.
- Amounts are exact decimals in normal units, and floats are never used: Paystack `750000` (kobo) is sent as `'7500'`, and Stripe `2000` USD as `'20'`.
- A helper returns the confirmation, or `null` when there is nothing to send (warning `unrecognised_payment_response`). `buildFromPaystack()` and the other `buildFrom*()` methods return the body without sending it.
- `confirm()` checks `provider`, `reference`, `status` (`success`, `partial`, `pending`, `failed`, `refunded`, `reversed`), `amount` or `amountMinor`, `currency`, `aliases` (at most 5), `clickId`, `goal`, `test` and `occurredAt` locally, and throws `InvalidRequestException` before anything is sent.
- In private mode every one of those fields is allowed. Anything extra is refused.
- Payments need the Starter plan or above: on Free the API answers `403 plan_feature_unavailable` (`PermissionException`, `getRequiredPlan()` is `starter`).
- `provider` and `reference` are required on a Payment goal (`422 payment_goal_needs_confirmation`, with `missing`); the SDK can't check it, because the kind lives only in the goal's settings. `conversions->create([... 'goal' => ...])` on a Payment goal is the same confirmation and returns the goal event (`$result['object'] === 'goal_event'`).

## Webhooks

```php
use Clikgate\Webhooks;

$event = Webhooks::verify(file_get_contents('php://input'), $_SERVER['HTTP_CLIKGATE_SIGNATURE'] ?? null, getenv('CLIKGATE_WEBHOOK_SECRET'));
```

- Pass the **raw** body. Deliveries are at-least-once: dedupe on `$event['id']`.
- Use `Webhooks::verifyAny($body, $header, [$newSecret, $oldSecret])` while you rotate your own secrets.

## Private mode

- With `'privateMode' => 'auto'` (the default), the SDK reads your organisation's setting from `GET /v1/server-sdk/config` and caches it for 10 minutes (per PHP process).
- When private mode is on, only `goal`, `clickId`, `code`, `reference`, `value`, `currency`, `isFirst`, `occurredAt`, `provider` and `consent` are sent. Anything else (`metadata`, emails, customer IDs, …) is refused **before sending** with `PrivateModeFieldRejectedException`, which names the field, never its value.
- Payment confirmations allow their own fields (see Payments). References are redacted in logs. If the setting can't be loaded, the SDK assumes private mode is on.

## Links

```php
$link = $clikgate->links->create(['destination_url' => 'https://example.com/spring', 'og_title' => 'Spring sale']);
$result = $clikgate->links->update($link['id'], ['destination_url' => 'https://example.com/summer']);
if (!$result['applied']) { echo 'waiting for a second person: ', $result['change_request']['id']; }
foreach ($clikgate->links->list(['limit' => 100]) as $link) { echo $link['short_url'], "\n"; }
// Filter by your own link metadata (sent as metadata[seller_id]=sel_ada); analytics take it too.
foreach ($clikgate->links->list(['metadata' => ['seller_id' => 'sel_ada']]) as $link) { echo $link['metadata']['seller_id'], "\n"; }
$ada = $clikgate->api->analytics->analyticsSummary(from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z', metadata: ['seller_id' => 'sel_ada']);
```

A locked link throws `LinkLockedException`. `$clikgate->api-><resource>-><operation>()` exposes every other API-key operation ("advanced"), generated from the OpenAPI document and sent through the same pipeline.

## Errors

Every exception extends `Clikgate\Exception\ClikgateException` (`getErrorCode()`, `getHttpStatus()`, `getRequestId()`, `getParam()`, `getErrorType()`, `getRaw()`): `ConfigurationException`, `AuthenticationException`, `PermissionException`, `InvalidRequestException`, `PrivateModeFieldRejectedException`, `NotFoundException`, `ConflictException`, `LinkLockedException`, `IdempotencyException`, `RateLimitException` (`getRetryAfter()`), `ServerException`, `ClikgateNetworkException`, `ClikgateTimeoutException` and `SignatureVerificationException`.

Network errors, timeouts and HTTP 429, 500, 502, 503 and 504 are retried up to `maxRetries` (3) with full-jitter backoff, honouring `Retry-After`. Each call sends a random `Idempotency-Key`, reused across its retries; the API ignores a second goal event with the same goal and reference, so a retry never double counts.

## Options

`new Clikgate([...])` takes `apiKey`, `baseUrl`, `timeout` (seconds, default 3), `maxRetries`, `sendMode`, `privateMode`, `clickIdParam`, `logger` (PSR-3), `onError`, `httpClient` (PSR-18), `proxy` (`http(s)://user:pass@host:port` or `false`), `batchSize`, `maxQueueSize` and `shutdownHooks`. An unknown option throws `ConfigurationException`.

- With the built-in transport (ext-curl), `timeout` and `proxy` apply, and libcurl reads `https_proxy`/`HTTPS_PROXY`/`NO_PROXY`.
- With your own PSR-18 client, configure its timeout and proxy on that client.

Licence: MIT. Security: see [SECURITY.md](SECURITY.md).
