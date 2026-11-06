# clikgate/clikgate-laravel

Laravel integration for [`clikgate/clikgate-php`](https://github.com/clikgate/clikgate-php): an auto-discovered service provider, the `Clikgate` facade, the `clikgate` middleware, `$request->clikgateClickId()`, and queued goal sending. Laravel 11, 12 and 13.

```bash
composer require clikgate/clikgate-laravel
```

Set `CLIKGATE_API_KEY=cg_live_…` (or `cg_test_…`) in `.env`. To change other settings, publish the config with `php artisan vendor:publish --tag=clikgate-config`.

```php
use Clikgate\Laravel\Facades\Clikgate;

Clikgate::goal('account_opened', ['clickId' => $application->click_id, 'reference' => $application->reference, 'value' => '2000000']);
```

## Keep the click ID

```php
// bootstrap/app.php
->withMiddleware(function (Middleware $middleware) {
    $middleware->web(append: ['clikgate']);
})

// a controller: save it with your own record
Application::create(['reference' => 'APP-55231', 'click_id' => $request->clikgateClickId()]);
```

- The middleware keeps a `?cgid=…` in the first-party `_cg_cgid` cookie, which the web script also reads.
- The provider excludes that cookie from `EncryptCookies`, so the web script can read it.

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

1. **Persist it from the query:** the `clikgate` middleware above does it on every page of the `web` group, with the `_cg_kept=s` marker (goals then report `kept_by: server_cookie`).
2. **The `/cg/keep` route**, for pages Laravel doesn't render (a static or cached landing page): register it, and add `data-server-endpoint="/cg/keep"` to the web script.

```php
// routes/web.php
Route::clikgateKeep('/cg/keep');
```

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_test_…" data-server-endpoint="/cg/keep" async></script>
```

- **Same server only.** The route must be served by the same host as the website (same scheme, host and port), because the cookie is first-party.
- **CSRF:** the macro removes Laravel's CSRF middleware (`ValidateCsrfToken`) from this one route, because the web script has no CSRF token. The route checks the origin itself (`Sec-Fetch-Site: same-origin`, else an `Origin` equal to the host), accepts only a JSON body of at most 1 KB with the same valid click ID in `click_id` and `page_click_id`, and changes nothing but these two cookies. Every answer is empty with `Cache-Control: no-store, private`; it never redirects and never echoes or logs what it receives.
- **Settings:** `cookie.days` (1 to 400, default 30) and `cookie.domain` in `config/clikgate.php`. `Secure` is always on unless `cookie.keep_secure` is false. The cookie name comes from `click_id_param` (else `cgid`), never from the request.
- **The cookie is readable by the page on purpose** (not `HttpOnly`, and excluded from `EncryptCookies`): the web script needs to read it. It only holds the click ID.
- **Visitor context for goals:** `Clikgate::clickIds()->context($request)` returns `clickId`, `keptBy`, `browserEngine` and `platform`, worked out in the SDK from the cookie and the `User-Agent` (the User-Agent itself is never sent): `Clikgate::goal('account_opened', ['reference' => $application->reference, ...Clikgate::clickIds()->context($request)])`. Allowed in private mode.
- **Hashed email and phone for ad networks:** when the business has turned on matching by hashed email or phone for a destination, add `\Clikgate\HashForAds::hash($email, $phone)` to a goal's options (`hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits`; see the `clikgate/clikgate-php` README). In private mode, hash on your own server: Clikgate never hashes for you there.

## Queued sending (recommended)

Set `CLIKGATE_QUEUE=redis` (any queue connection) and, optionally, `CLIKGATE_QUEUE_NAME`.

- `Clikgate::goal()` then dispatches a `Clikgate\Laravel\Jobs\SendGoal` job, and the queue retries it on network errors, timeouts and HTTP 429, 500, 502, 503 and 504.
- Each send uses a random `Idempotency-Key` (reused across the HTTP retries inside one attempt), and the API ignores a second event with the same goal and reference, so a queue retry never counts twice.
- Without a queue, `goal()` uses `CLIKGATE_SEND_MODE`: `sync` (the default), `after_response` or `background`.

## Everything else

- `Clikgate::payments()->fromPaystack($verifyResponse)` (and `fromFlutterwave`, `fromMonnify`, `fromStripe`, `confirm([...])`): confirm a payment **right after your own verification with the gateway**, never with data from the browser or the app (see the PHP SDK's Payments section).
- `Clikgate::goal('order_paid', ['reference' => 'T123456', 'provider' => Provider::Paystack])` reports a payment on a Payment goal; results carry `status` (`GoalStatus`: `counted`, `waiting`, `refused`). See the PHP SDK's Payment goals section.
- `Clikgate::goals()->send(…)`, `Clikgate::links()`, `Clikgate::clickIds()` and `Clikgate::api()`.
- `Clikgate::verifyWebhook($request->getContent(), $request->header('Clikgate-Signature'), $secret)`.
- `app(\Clikgate\Clikgate::class)` gives the client itself.

See [`clikgate/clikgate-php`](https://github.com/clikgate/clikgate-php#readme). The full example is in `examples/routes/web.php`.

Licence: MIT. Security: see [SECURITY.md](SECURITY.md).
