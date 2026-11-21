# End-to-end sample: PHP (Slim 4, PSR-15)

The backend of a mobile app with Clikgate added, using `clikgate/clikgate-php` and its PSR-15 middleware. The routes,
and what each one shows, are in [the overview](../README.md).

## Why Slim and not Laravel

The SDK calls are the same in both: the Laravel facade wraps this same client. Slim keeps the sample to a few short
files and a small dependency tree, so it installs in seconds in CI and nothing hides the Clikgate calls. The PSR-15
middleware used here also works in Mezzio and any other PSR-15 stack. With Laravel, use `clikgate/clikgate-laravel`:
`Clikgate::createIdentityToken(...)`, `$request->clikgateInstallation()` and `Clikgate::payments()` replace the
calls in `src/` one for one (see the Laravel package README).

## Run it

You need PHP 8.1 or later and Composer.

```bash
# 1. Install (this links the SDK from this repository; see "SDK version" below)
composer install

# 2. Configure: copy the placeholders and fill in your test keys
cp .env.example .env
set -a; . ./.env; set +a

# 3. Start the backend on http://localhost:8080
php -S localhost:8080 -t public
```

Run the test (it starts a fake Clikgate API, so it never calls the real one):

```bash
composer test
```

## Where things are

| File | What it shows |
| --- | --- |
| `src/Identity/AuthRoutes.php` | Sign-up, sign-in and `/me` return `clikgateIdentityToken`; sign-up sends a server goal |
| `src/Identity/ClikgateIdentity.php` | Path A (identity token with the account date) and Path B (the middleware's installation and `identifyUser`) |
| `src/Payments/PaymentRoutes.php` | `payments->fromPaystack(...)` after the backend's own check (`verifyWithPaystack` is a stub) |
| `src/Webhooks/WebhookRoutes.php` | Raw-body verification, the event-ID store, and `handleReferralEvent` |
| `src/Webhooks/RewardStore.php` | Pay once per referral |
| `src/Referrals/ReferralRoutes.php` | `GET /me/referral`: get or create the user's referrer code |
| `src/AppFactory.php` | One client with `sendMode` `after_response`, and the middleware order |
| `tests/EndToEndFlowTest.php` | The whole flow against the fake API in `tests/fake-clikgate-router.php` |

PHP keeps nothing in memory between requests, so the sample's tables (users, sessions, processed events, rewards) are
saved to one JSON file in the system temp folder (`SAMPLE_STATE_FILE` to choose another). Each store's comment says
which table replaces it in your app.

## SDK version

`composer.json` installs `clikgate/clikgate-php` from `server/php` in this repository (a Composer `path` repository,
as version 2.0.3), so the sample works before that version is published. At release, delete the `repositories` block
and run `composer update clikgate/clikgate-php`. The referral code and the referral webhook payload are read without
SDK helpers for now: look for `Clikgate SDK 2.1.0` in the code, and switch to the typed methods when you move to
version 2.1.0.
