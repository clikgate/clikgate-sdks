# Changelog: clikgate/clikgate-laravel

All notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/).

## [2.1.0] - unreleased

### Typed models

- **Fixed:** `Clikgate::identifyUser(['installation' => $request->clikgateInstallation(), ...])` works: the parsed installation is accepted as well as the raw header.
- **Added:** `Clikgate::referrals()`, `Clikgate::privacy()`, `Clikgate::people()`, `Clikgate::installs()` and `Clikgate::codes()`, the new resources of `clikgate/clikgate-php` 2.1.0, which return typed models (`$referrer->customerId`, `$referral->reward?->referrer?->amount`).
- **Changed:** `Clikgate::verifyWebhook()` returns a `Clikgate\Model\WebhookEvent` with `asReferral()`, `asReferrer()`, `asGoalEvent()`, `asInstall()`, `asPayment()`, `asConversion()`, `asDeviceChange()`, and `$event->type` (compare it with the `EventType` string constants); array access (`$event['type']`) keeps working.
- **Changed:** link methods (`Clikgate::links()`) return `Link`, `LinkUpdateResult` and `Page` objects, not arrays. Array access (`$link['short_url']`) keeps working, but `is_array()` on a link result is now `false`, so code that checks it breaks: call `->toArray()` to get the array.
- Requires `clikgate/clikgate-php` 2.1.0.

## [2.0.3] - unreleased

### Identify users with the installation header

- **Added:** `$request->clikgateInstallation()`: the app's `Clikgate-Installation` header as a `Clikgate\Installation` (`->appId`, `->installationId`), or `null` when it is missing or invalid. Spread `$installation->toArray()` into `Clikgate::identifyUser()`, after your own sign-in check, with your signed-in user's ID (never a customer ID read from the request). `Clikgate::identifyUser()` also takes the raw header as `installation`, and `appId` is optional. Requires `clikgate/clikgate-php` 2.0.3.

## [2.0.1] - unreleased

### Existing users

- **Added:** `Clikgate::createIdentityToken($customerId, ['customerSince' => $user->created_at])` makes a version 2 token with the account date; `Clikgate::identifyUser()` takes `customerSince` and `customerSinceReplace`; `Clikgate::knownCustomers()` imports and removes existing customers. Requires `clikgate/clikgate-php` 2.0.1.

## [2.0.0] - unreleased

### Breaking: track() removed in favour of goal()

- **Removed:** `track()` and app events are gone from Clikgate in favour of one method, `goal()`, for anything that happens in an app, website or server. A name that isn't set up as a goal yet still arrives (status `received`) and shows in the dashboard under "Seen from your app and website", ready to be counted. This package now requires `clikgate/clikgate-php` ^2.0, which drops the generated app events resource: send goals with `Clikgate::goal()` or the queued goal sending.

### Breaking: Laravel 11 is no longer supported; Laravel 12+ required

- **Removed:** Laravel 11 support. Every Laravel 11.x release now has a security advisory (Laravel 11 has been end of life since 2026-03-12), so Composer refuses to install it. This version needs Laravel 12 or 13 (`illuminate/*` `^12.0 || ^13.0`); PHP 8.2+ as before.

### Strict goal names
- A queued goal (`SendGoal`) refused with `unknown_goal` (the organisation accepts only set-up goals) or `goal_archived` ends the job without failing it: it is never retried or kept as a failed job. With `LOG_LEVEL=debug` the SDK logs "Goal `{name}` isn't set up in Clikgate" (goal name only).

### Identity tokens
- `Clikgate::createIdentityToken($customerId, ['appId' => …])` with the new config keys `identity_secret` (`CLIKGATE_IDENTITY_SECRET`) and `identity_secrets` (`CLIKGATE_IDENTITY_SECRETS`, a JSON object of app IDs to secrets). A malformed `identity_secrets` only fails token creation (`invalid_identity_secrets`); the rest of the client keeps working. Guide: https://clikgate.com/docs/identify-users.
- `Clikgate::identifyUser([...])` on the facade, documented with path B (`appId` + `installationId` + `customerId`, no secret or token).
- From `clikgate/clikgate-php`: `GoalStatus::Received` and the app events resource removed from the generated API.

### Hashed email and phone for ad network matching
- `\Clikgate\HashForAds::hash()` and the goal options `hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits` (from `clikgate/clikgate-php`) work through the facade and `SendGoal`.

### Keeping the click ID
- **Added:** `Route::clikgateKeep('/cg/keep')`: the `/cg/keep` route for the web script's `data-server-endpoint="/cg/keep"` (controller `Clikgate\Laravel\Http\Controllers\KeepClickId`). It skips Laravel's CSRF middleware for that route only (it checks `Sec-Fetch-Site` / `Origin` itself) and uses `cookie.days`, `cookie.domain` and the new `cookie.keep_secure` (default true) from `config/clikgate.php`.
- **Changed:** the `clikgate` middleware also sets the `_cg_kept=s` marker (from `clikgate/clikgate-php`), and the provider excludes `_cg_kept` from `EncryptCookies`.
- `Clikgate::clickIds()->context($request)` and the goal options `keptBy`, `browserEngine`, `platform` work through the facade and `SendGoal`.

### Breaking
- With `clikgate/clikgate-php` (Unreleased), a goal event's `status` is the `GoalStatus` (`counted`, `waiting`,
  `refused`); the conversion state moved to `event_status`. See that package's changelog.

### Added
- The `provider` goal option and the `GoalKind`, `GoalStatus` and `Provider` enums of `clikgate/clikgate-php` work
  through the facade, the manager and `SendGoal`.
- `Clikgate::payments()`: the PHP SDK's `payments` resource (`confirm`, `fromPaystack`, `fromFlutterwave`, `fromMonnify`, `fromStripe`, `buildFrom*`) through the facade and the manager.

## [1.1.0] - unreleased

### Changed
- With `clikgate/clikgate-php` 1.1, each `SendGoal` attempt sends a random `Idempotency-Key`; the API dedupes goal events by goal and reference, so a queue retry still never counts twice.

## [1.0.0] - unreleased (first release)

### Added
- Auto-discovered `ClikgateServiceProvider` (client singleton from `config/clikgate.php`), the `Clikgate` facade, the `clikgate` middleware alias, the `$request->clikgateClickId()` macro, and the click-ID cookie excluded from `EncryptCookies`.
- Queued sending with `CLIKGATE_QUEUE` (`Clikgate\Laravel\Jobs\SendGoal`).
- Laravel 11, 12 and 13; PHP 8.2+.
