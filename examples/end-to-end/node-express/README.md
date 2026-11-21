# End-to-end sample: Node.js (Express, TypeScript)

The backend of a mobile app with Clikgate added, using `@clikgate/node` and its Express middleware. The routes, and
what each one shows, are in [the overview](../README.md).

## Run it

You need Node.js 22.18 or later: it runs the TypeScript files directly, with no build step.

```bash
# 1. Build the SDK from this repository (see "SDK version" below)
(cd ../../../server/node && npm ci && npm run build)

# 2. Install, then configure: copy the placeholders and fill in your test keys
npm install
cp .env.example .env

# 3. Start the backend on http://localhost:3000 (reads .env)
npm start
```

Check and test (the test starts a fake Clikgate API, so it never calls the real one):

```bash
npm run typecheck
npm test
```

## Where things are

| File | What it shows |
| --- | --- |
| `src/auth.ts` | Sign-up, sign-in and `/me` return `clikgateIdentityToken`; sign-up sends a server goal |
| `src/identity.ts` | Path A (identity token with the account date) and Path B (`req.clikgate.installation` and `identifyUser`) |
| `src/payments.ts` | `payments.fromPaystack(...)` after the backend's own check (`verifyWithPaystack` is a stub) |
| `src/webhooks.ts` | Raw-body verification, the event-ID store, and `handleReferralEvent` |
| `src/rewards.ts` | The processed-event store and the reward store (pay once per referral) |
| `src/referrals.ts` | `GET /me/referral`: get or create the user's referrer code |
| `test/flow.test.ts` | The whole flow against `test/fake-clikgate.ts` |

Users, sessions, processed events and rewards are kept in memory. Each store's comment says which table replaces it in
your app.

## SDK version

`package.json` points `@clikgate/node` at `server/node` in this repository (`file:../../../server/node`), so the
sample works before version 2.0.3 is published. At release, change it to the published version
(`"@clikgate/node": "^2.0.3"`) and skip step 1. The referral code and the referral webhook payload are read without
SDK helpers for now: look for `Clikgate SDK 2.1.0` in the code, and switch to the typed methods when you move to
version 2.1.0.
