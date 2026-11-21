# clikgate/clikgate-laravel

Laravel integration for [`clikgate/clikgate-php`](https://github.com/clikgate/clikgate-php): an auto-discovered service provider, the `Clikgate` facade, the `clikgate` middleware, `$request->clikgateClickId()`, `$request->clikgateInstallation()`, and queued goal sending. Laravel 12 and 13.

```bash
composer require clikgate/clikgate-laravel
```

Set `CLIKGATE_API_KEY=cg_live_…` (or `cg_test_…`) in `.env`. To change other settings, publish the config with `php artisan vendor:publish --tag=clikgate-config`.

```php
use Clikgate\Laravel\Facades\Clikgate;

Clikgate::goal('account_opened', ['clickId' => $application->click_id, 'reference' => $application->reference, 'value' => '2000000']);
```

## End to end

One flow with the typed methods only.

```php
use Clikgate\Enum\EventType;
use Clikgate\Enum\Provider;
use Clikgate\Laravel\Facades\Clikgate;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

// 1. Sign-in: after YOUR own sign-in check. The customer ID is the signed-in user's ID, never read from the request.
Route::post('/login', function (Request $request) {
    if (!Auth::attempt($request->only('email', 'password'))) {
        abort(401);
    }
    $user = Auth::user();
    $customerId = (string) $user->id;
    // Path B: the app's Clikgate-Installation header, no secret (null when missing or invalid: skip the call)
    if (null !== $installation = $request->clikgateInstallation()) {
        Clikgate::identifyUser(['installation' => $installation, 'customerId' => $customerId]);
    }
    // Path A: an identity token the app passes to the mobile SDK; 4. and the user's referral code and link
    $referrer = Clikgate::referrals()->getOrCreateReferrer('rpg_01J…', ['customerId' => $customerId, 'displayName' => $user->name]);

    return ['user' => $user, 'clikgateIdentityToken' => Clikgate::createIdentityToken($customerId, ['customerSince' => $user->created_at]), 'referralCode' => $referrer->code, 'referralUrl' => $referrer->url];
});

// 2. Goals (queued with CLIKGATE_QUEUE) and 3. payments, right after your own verification with the gateway
Clikgate::goal('account_opened', ['clickId' => $request->clikgateClickId(), 'reference' => 'APP-55231', 'isFirst' => true]);
Clikgate::payments()->confirm(['provider' => Provider::Paystack, 'reference' => 'T123456', 'status' => 'success', 'amount' => '7500', 'currency' => 'NGN', 'goal' => 'order_paid']);

// 5. Webhooks: the raw body, then the typed object
Route::post('/webhooks/clikgate', function (Request $request) {
    $event = Clikgate::verifyWebhook($request->getContent(), $request->header('Clikgate-Signature'), (string) config('services.clikgate.webhook_secret'));
    $referral = $event->asReferral();   // null for other event types
    if (null !== $referral && EventType::ReferralQualified === $event->type) {
        // Clikgate never pays rewards: grant yours, once per $event->id
        grantReward($referral->referrer->customerId, $referral->reward?->referrer?->amount);   // '500.00'
    }

    return response()->noContent();
});
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
- `$request->clikgateInstallation()` reads the app's `Clikgate-Installation` header (for `identifyUser`): an `Installation` (`->appId`, `->installationId`) or `null` when it is missing or invalid. Pass it to `identifyUser` as `installation` as it is. It works with or without the middleware.

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

## Identify your users

Full guide: https://clikgate.com/docs/identify-users. **Path A (default):** set `CLIKGATE_IDENTITY_SECRET` (Developers › SDKs › your app › Set up identity › Identity secret) on the server only, and add one field to your sign-in and "current user" responses; the app passes it to the mobile SDK's `identifyUser()`. For several apps, `CLIKGATE_IDENTITY_SECRETS` is a JSON object of app IDs to secrets.

```php
return response()->json(['user' => $user, 'clikgateIdentityToken' => Clikgate::createIdentityToken((string) $user->id)]);
Clikgate::createIdentityToken((string) $user->id, ['appId' => 'app_…']);   // several apps
```

**Path B: the installation header, no secret or token.** The mobile SDK gives your app a `Clikgate-Installation` header (`<app_id>:<installation_id>`, not a secret), which the app sends to your server with its sign-in request and signed-in requests. After your own sign-in check succeeds, and at every signed-in app open, pass it to `Clikgate::identifyUser()` as `installation` with your signed-in user's ID. Your server never needs to know which Clikgate app ID belongs to which platform. Clikgate accepts installations active in the last 7 days.

- **The customer ID always comes from your own authenticated user.** The header only names the app installation. Call `Clikgate::identifyUser()` only after your sign-in check succeeds, and never read the customer ID from the request.
- **A missing or invalid header is ignored** (`null`, never an error or a log line): skip the call. Parsing is strict: `app_…`, one colon, a lowercase UUID, at most 128 characters, trimmed.
- **`appId` is optional.** With only an installation ID, Clikgate finds the app. If the same installation ID is active in several of your apps (iOS apps sharing a Keychain access group can share one), the API answers `409 installation_in_several_apps`, a `ConflictException` with param `app_id`: send `appId` too.

```php
// After your own sign-in check (Auth::attempt), with the signed-in user's ID
if (Auth::attempt($credentials) && ($installation = $request->clikgateInstallation()) !== null) {
    Clikgate::identifyUser(['installation' => $installation, 'customerId' => (string) Auth::id()]);
}
```
## Customers from before Clikgate

Tell Clikgate who was already your customer before you added it, so they are never counted as a referral or a new customer. Send the account's creation date with the identity token (version 2) or from your server, and import the rest of your existing customers once. Use your own customer IDs, never emails or phone numbers: Clikgate stores a keyed fingerprint of each imported ID, not the ID itself. Not available in private mode. Guide: https://clikgate.com/docs/identify-users.

```php
Clikgate::createIdentityToken((string) $user->id, ['customerSince' => $user->created_at]); // version 2
Clikgate::knownCustomers()->import([['customerId' => 'u_10482', 'customerSince' => '2024-03-02']]);
```

## Queued sending (recommended)

Set `CLIKGATE_QUEUE=redis` (any queue connection) and, optionally, `CLIKGATE_QUEUE_NAME`.

- `Clikgate::goal()` then dispatches a `Clikgate\Laravel\Jobs\SendGoal` job, and the queue retries it on network errors, timeouts and HTTP 429, 500, 502, 503 and 504.
- Each send uses a random `Idempotency-Key` (reused across the HTTP retries inside one attempt), and the API ignores a second event with the same goal and reference, so a queue retry never counts twice.
- Without a queue, `goal()` uses `CLIKGATE_SEND_MODE`: `sync` (the default), `after_response` or `background`.

## Everything else

- `Clikgate::payments()->fromPaystack($verifyResponse)` (and `fromFlutterwave`, `fromMonnify`, `fromStripe`, `confirm([...])`): confirm a payment **right after your own verification with the gateway**, never with data from the browser or the app (see the PHP SDK's Payments section).
- `Clikgate::goal('order_paid', ['reference' => 'T123456', 'provider' => Provider::Paystack])` reports a payment on a Payment goal; results carry `status` (`GoalStatus`: `counted`, `waiting`, `received`, `refused`). See the PHP SDK's Payment goals section.
- `Clikgate::goals()->send(…)`, `Clikgate::links()`, `Clikgate::clickIds()` and `Clikgate::api()`. Link methods return typed models (`$link->shortUrl`) that keep array access (`$link['short_url']`).
- `Clikgate::referrals()`, `Clikgate::privacy()`, `Clikgate::people()`, `Clikgate::installs()` and `Clikgate::codes()`: typed resources (see the PHP SDK's "Referrals, privacy, people, installs and codes" section).
- `Clikgate::verifyWebhook($request->getContent(), $request->header('Clikgate-Signature'), $secret)` returns a `Clikgate\Model\WebhookEvent`: `asReferral()`, `asReferrer()`, `asGoalEvent()`, `asInstall()`, `asPayment()`, `asConversion()`, `asDeviceChange()`; compare `$event->type` with the `EventType` string constants; `$event['type']` keeps working.
- `app(\Clikgate\Clikgate::class)` gives the client itself.

See [`clikgate/clikgate-php`](https://github.com/clikgate/clikgate-php#readme). The full example is in `examples/routes/web.php`.

Licence: MIT. Security: report vulnerabilities to support@clikgate.com; see the [trust centre](https://clikgate.com/trust).
