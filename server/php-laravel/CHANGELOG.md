# Changelog: clikgate/clikgate-laravel

All notable changes to this package. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package uses [semantic versioning](https://semver.org/).

## [Unreleased]

### Hashed email and phone for ad network matching (change 19)
- `\Clikgate\HashForAds::hash()` and the goal options `hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits` (from `clikgate/clikgate-php`) work through the facade and `SendGoal`.

### Keeping the click ID (change 16)
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
