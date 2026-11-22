# End-to-end samples: the backend of a mobile app

Small, complete backends that show everything a mobile app's server does with Clikgate, from sign-up to paying a
referral reward. There is one per language, and they all answer the same routes, so the
[Flutter sample app](https://github.com/clikgate/clikgate-mobile-sdk/tree/main/examples/flutter-end-to-end) works with
any of them. The full walkthrough is [Backend setup for your mobile app](https://clikgate.com/docs/backend-setup).

| Sample | Stack |
| --- | --- |
| [`spring-boot`](spring-boot) | Spring Boot 4, Java 17+, `clikgate-spring-boot-starter` |
| [`node-express`](node-express) | Node.js 22.18+, Express 5, TypeScript, `@clikgate/node` |
| [`python-fastapi`](python-fastapi) | Python 3.9+, FastAPI, `clikgate` (`AsyncClikgate`) |
| [`php-slim`](php-slim) | PHP 8.1+, Slim 4 (PSR-15), `clikgate/clikgate-php` |
| [`dotnet-minimal-api`](dotnet-minimal-api) | .NET 10, ASP.NET Core minimal API, `Clikgate.AspNetCore` |

## What each sample shows

1. **Identity tokens.** Sign-up, sign-in and `GET /me` return `clikgateIdentityToken`, made with
   `createIdentityToken` from the user ID and the account's creation date (`customerSince`). The date is always sent, so
   Clikgate can tell an existing customer from a new one.
2. **The installation header (no token needed).** The backend reads the app's `Clikgate-Installation` header with the
   SDK's framework helper and, after its own sign-in check, calls `identifyUser` with the installation, the customer ID
   and the account date. An app uses either this or the token; the samples show both.
3. **A server goal.** Sign-up sends `account_opened` with `goal()`.
4. **A payment confirmation.** `payments.fromPaystack` with the gateway's answer, after the backend's own check. The
   Paystack call is stubbed, so no Paystack account is needed.
5. **Webhooks.** The raw body is verified, event IDs are stored so a repeat delivery does nothing, and
   `referral.qualified` pays the referrer once (`referral.disqualified` pays nothing).
6. **The referral code.** `GET /me/referral` gets or creates the signed-in user's referrer code.

Users, sessions, processed events and rewards are kept in memory (PHP saves them to a JSON file, because it keeps
nothing between requests). Each store's comment says which database table replaces it in your app.

## Routes

| Route | Body | Answer |
| --- | --- | --- |
| `POST /auth/sign-up` | `{"email", "password"}` | `201 {"user", "accessToken", "clikgateIdentityToken"}`, `409` when the email is taken |
| `POST /auth/sign-in` | `{"email", "password"}` | `200 {"user", "accessToken", "clikgateIdentityToken"}`, `401` for a wrong password |
| `GET /me` | | `200 {"user", "clikgateIdentityToken"}`, `401` without a session |
| `POST /payments/paystack/confirm` | `{"reference"}` | `200 {"status": "paid", "reference"}`, `402 {"error"}` when the payment didn't succeed |
| `GET /me/referral` | | `200 {"code", "link"}` |
| `POST /webhooks/clikgate` | the signed event | `200`, or `400 {"error"}` for a bad signature |

`user` is `{"id", "email", "createdAt"}`. Signed-in routes take `Authorization: Bearer <accessToken>`, and every route
the app calls reads the optional `Clikgate-Installation` header. `clikgateIdentityToken` is `null` when the backend has
no identity secret.

## Configuration

Every sample reads the same environment variables. Each folder has a `.env.example` with placeholders: copy it to
`.env` and fill in your test keys. Never commit real keys.

| Variable | |
| --- | --- |
| `CLIKGATE_API_KEY` | Server API key (`cg_test_…` while you test) |
| `CLIKGATE_IDENTITY_SECRET` | Optional: the app's identity secret. Without it, responses carry no token |
| `CLIKGATE_WEBHOOK_SECRET` | The webhook endpoint's signing secret (`whsec_…`) |
| `CLIKGATE_REFERRAL_PROGRAM_ID` | Your referral program (`rpg_…`) |
| `CLIKGATE_BASE_URL` | Optional, for a local fake of the API only |

## Tests

Each sample has one test that runs the whole flow against a fake Clikgate API started by the test on `127.0.0.1`.
It never calls the real API and needs no keys. The `end-to-end-samples` workflow builds and tests every sample.

## Code regions for the docs

The documentation shows parts of these files. The parts are marked with `#region <name>` and `#endregion` comments:
`identity-token`, `identify-installation`, `server-goal`, `from-paystack`, `webhook`, `referral-event` and
`referral-code`.

## SDK versions

The Node, Python and PHP samples build against SDK 2.1.1 and the Java and .NET samples against 2.1.0, from this
repository (a path, file or project reference), so they work before a version is published. Each sample's README says what to change at release. Two functions per sample use the typed
referral methods and typed webhook events of 2.1.0:

- `getOrCreateReferralCode` (`get_or_create_referral_code` in Python) is one call that gets or creates
  the user's referrer: Node `clikgate.referrals.getOrCreateReferrer(programId, { customerId })`,
  Python `clikgate.referrals.get_or_create_referrer(program_id, customer_id=...)`, PHP
  `$clikgate->referrals->getOrCreateReferrer($programId, ['customerId' => ...])`, Java
  `clikgate.referrals().getOrCreateReferrer(programId, customerId)` and .NET
  `clikgate.Referrals.GetOrCreateReferrerAsync(programId, customerId)`. The same user always gets the same code.
- `handleReferralEvent` (`handle_referral_event` in Python) reads the referral with `event.asReferral()`
  (`as_referral()` in Python, `$event->asReferral()` in PHP, `AsReferral()` in .NET) and compares the event type with `EventType` constants
  (`EventType.ReferralQualified` in Node and PHP, `EventType.REFERRAL_QUALIFIED` in Python, Java and .NET). Java's
  `asReferral()` returns null for an event of another family; the Java sample checks the type first anyway, which reads clearly.
