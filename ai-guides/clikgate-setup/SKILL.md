---
name: clikgate-setup
description: Sets up Clikgate (deep links, app links, install attribution and goals) in Flutter, React Native, Expo, native Android and native iOS apps, adds the Clikgate web script to a website, and adds a Clikgate server SDK to send goals and verify webhooks. Use it when the user asks to install, configure, check or fix Clikgate, the Clikgate SDK key, app links on an app's link subdomain (yourapp.ciz.to, yourapp.clk.ng on the Free plan, yourapp.dev.ciz.to), Clikgate test links, goal tracking, or the npx @clikgate/setup command.
license: MIT
metadata:
  version: "{{versions.setup}}"
  docs: "https://clikgate.com/docs/ai"
---

# Set up Clikgate

Clikgate tracks every click on a link through to the app install, the app open and the business's end goal (an account opened, an order paid). This skill sets it up in the user's project and checks the result.

## Rules (always follow them)

1. **Show changes before applying them.** Show the diff or the plan and get a yes. If the user has already approved the changes in advance, show them anyway, then apply them.
2. **Test keys only.** Put only the **test** SDK key (`cg_sdk_test_…`) in app code. Never write a live SDK key (`cg_sdk_live_…`) and never write any API key (`cg_live_…`, `cg_test_…`) into app code, web pages or the repository. Going live is the user's step (see "Going live").
3. **Server API keys live in the `CLIKGATE_API_KEY` environment variable**, never in source, config files that get committed, or logs.
4. **App links use the app's own link subdomain, never a shared domain.** Release builds: `<link_subdomain>.ciz.to` (`<link_subdomain>.clk.ng` on the Free plan) plus the organisation's verified custom domains (the reference files call these the **live domains**). Debug builds: `<link_subdomain>.dev.ciz.to` as well. Never add the shared domains `ciz.to`, `clk.ng`, `clkg.to` or `dev.ciz.to` to a manifest, entitlements file or `linkDomains`: shared domains can't open the app. Never put a `*.dev.ciz.to` test host in a release manifest, release entitlements, or the Expo `linkDomains` list.
5. **Don't add device fingerprinting.** Don't add IDFA collection or an App Tracking Transparency prompt on iOS. Clikgate's SDKs don't need either.
6. **Respect consent.** Keep the app's existing consent flow, and pass its result to Clikgate (`setConsent`) when the app has one.
7. **No customer data in goal calls.** The goal key and `reference` hold the business's own reference (application number, order ID), never names, emails, phone numbers, account numbers or user IDs.
8. **Money is exact.** Send values in normal units (₦2,000,000 is `2000000`, never kobo) as `Decimal` / `BigDecimal` / `decimal` / strings, never floating point.
9. **Use only the APIs in [references/api-surface.md](references/api-surface.md).** If a method isn't listed there, it doesn't exist. Don't invent methods, options or flags.
10. **Never remove existing deep-link handling** (routers, other SDKs' link handlers, intent filters, entitlements). Add Clikgate alongside them.
11. **`goal()` is the only method for anything that happens in an app, website or server.** Clikgate has no separate event method. Use the snake_case name the team defined (or will tick) in the dashboard.
12. **The identity secret stays on the server.** Never put `CLIKGATE_IDENTITY_SECRET` (or any `cgis_…` value) in app code, web pages or the repository; it goes in the server's environment, like the API key.
13. **Test links** may point only to Clikgate's test pages, the organisation's verified websites, `localhost` or the local network, or verified tunnels ([references/test-links.md](references/test-links.md)).

## Step 1: What is being set up?

| The project is… | Read |
|---|---|
| a Flutter app (`pubspec.yaml` with `flutter:`) | [references/flutter.md](references/flutter.md) |
| a React Native app (`package.json` with `react-native`, no `expo`) | [references/react-native.md](references/react-native.md) |
| an Expo app (`package.json` with `expo`) | [references/expo.md](references/expo.md) |
| a native Android app (Gradle, no `package.json`/`pubspec.yaml`) | [references/android.md](references/android.md) |
| a native iOS app (`.xcodeproj`, no `package.json`/`pubspec.yaml`) | [references/ios.md](references/ios.md) |
| a website | [references/web.md](references/web.md) |
| a backend (Node.js, Python, PHP, Java, .NET) | [references/server-sdks.md](references/server-sdks.md) |

Goals (the end of the funnel) are in [references/goals.md](references/goals.md). Payment goals (the page or app reports, and a trusted source confirms) are in [references/payments.md](references/payments.md). Errors and their fixes are in [references/troubleshooting.md](references/troubleshooting.md).

## Step 2 (apps): Get what the setup needs

The setup command `npx @clikgate/setup` (Node 18 or newer) does the whole app setup. It detects the platform, adds the SDK, adds app links (the app's link subdomain and custom domains; the test subdomain in debug builds only) and the start-up code, then checks the result.

There are two ways to run it. **Ask the user which one they want before running anything.**

- **A. The user runs it in their own terminal (best).** Ask them to run `npx @clikgate/setup` in the project folder. It opens a browser where they approve the sign-in. It then picks or creates the Clikgate app, confirms the app's link subdomain if it isn't confirmed yet, sends the signing details, and asks about every change. If the user's account uses two-factor sign-in, the browser page asks for their authenticator code. You can't do this for them: it needs their browser and their answers.
- **B. Offline mode (you run it).** Use this when the user wants you to do it, or can't run A. It needs, from the Clikgate dashboard (Apps › the app › SDK keys and Link domains):
  - the app's **test SDK key** (`cg_sdk_test_…`);
  - the app's **link subdomain** host, for example `acme.ciz.to`, or `acme.clk.ng` on the Free plan (Apps › the app › Link subdomain), plus any **verified custom domains** the app should open, for example `go.acme.com`. Don't include the test host `acme.dev.ciz.to`: the command derives it from `acme.ciz.to` (or `acme.clk.ng`) and adds it to debug builds by itself. Never pass a shared domain (`ciz.to`, `clk.ng`, `clkg.to`, `dev.ciz.to`): the command refuses it.

  If the user hasn't given these, ask for them. Never guess a key, and never accept a `cg_sdk_live_` key (the command refuses it too).

### App link subdomains, not shared domains

Each app has its own **link subdomain** (`acme.ciz.to`; test links `acme.dev.ciz.to`), and its `apple-app-site-association` and `assetlinks.json` list only that app. The shared domains `ciz.to`, `clk.ng`, `clkg.to` and `dev.ciz.to` carry many organisations' links, so their files list **no** customer app and they can never open one. Links on them still work: they go through the browser, the store and deferred deep links. Tell the user that links meant to open the app should use the app subdomain (the dashboard picks it by default for links with app routing) or a custom domain.

If a project still lists a shared domain (from an older setup), doctor warns "remove this: shared domains can't open your app" (`android.shared_domains`, `ios.shared_domains`, `expo.shared_domains`). Show the user the lines and remove them after they say yes. The SDKs ({{versions.android}}+ native) also hand other organisations' shared-domain links to an in-app browser and tell the app through `onBrowserHandoff`, which is optional. Don't route them yourself.

If the app has no confirmed link subdomain yet, the user confirms it in the dashboard (Apps › the app › Link subdomain) before running the setup.

### Deep links, attribution and goals on every plan

- **Free and Starter include deep links into the app:** direct links (App Links, Universal Links, the URI scheme) without a limit, and deferred deep links (someone installs the app from a link and lands on the right screen) up to 1,000 a month on Free and 10,000 on Starter. Growth and up: unlimited. One app on Free and Starter (an iOS and Android pair counts as one).
- **The app subdomain depends on the plan.** Free: `acme.clk.ng` in release builds. Starter and up: `acme.ciz.to`. Debug builds: `acme.dev.ciz.to` on every plan. `acme.clk.ng` is the app's own subdomain, **not** the shared domain `clk.ng`, so it goes in release builds like `acme.ciz.to`. Signed in, the setup command reads the right hosts for the plan; offline, pass the host the dashboard shows (`--domain acme.clk.ng`). Doctor accepts both.
- **Events and goals work on every plan, up to the plan's allowance. Growth and up add re-engagement, Apple Ads, install fraud scoring, and uninstall tracking on Pro.** Set the SDK up the same way on every plan.
- **The dashboard chooses what counts.** Every name sent with `goal()` appears in "Seen from your app and website". It counts (reports, ad networks, usage) only once the team ticks "Count this as a goal"; until then the call answers `status: received` (`not_counted_yet`), which is a success, not an error. Goals created on the Goals page are counted from the start. Tell the user to tick new names; don't add workarounds.
- **Or the server refuses unknown names.** If the organisation turned off "Allow unknown goal names" (Settings › Goals; on by default, live keys only), a live call with a name that has no goal or alias behind it is refused: `422` with code and reason `unknown_goal` (`status: refused`, `counted: false`, `goal_kind: null`); an archived goal's name is refused with `goal_archived`. App SDKs return `REFUSED` with that reason, the web script `{status: "refused", reason: "unknown_goal"}`, server SDKs raise their invalid-request error with that code. It is final: never retry it, queue it or check names on the device. Test keys always answer `received`. The fix is in the dashboard: set the goal up (or add the name as an alias), or turn the setting back on.
- **At the monthly deferred deep link allowance** new installs open the app's home screen: the SDK gets its normal "no deferred link" result, never an error. Direct deep links keep working.

## Step 3 (apps): Run the setup (offline mode)

1. Preview. This changes nothing, and prints the plan and every diff:

   ```sh
   npx @clikgate/setup --sdk-key cg_sdk_test_… --domain acme.ciz.to,go.acme.com --dry-run
   ```

   Show the user the plan. `--domain` takes a comma-separated list: the app subdomain first, then any custom domains.
2. After the user says yes, apply:

   ```sh
   npx @clikgate/setup --sdk-key cg_sdk_test_… --domain acme.ciz.to,go.acme.com --yes
   ```

   - Add `--cwd <folder>` when the app isn't in the current folder (a monorepo), and `--platform <flutter|react-native|expo|android|ios>` when several are detected.
   - If the package install step fails (no network, no Flutter or CocoaPods on PATH), run the same command with `--no-install` and tell the user which install command to run.
   - Without `--yes` in a non-interactive shell, nothing is applied and the exit code is 2.
3. Read the output. It ends with **"Clikgate sees every click. Setup complete."** Pass on to the user every line under **Manual steps:** and **Reminders:**, because offline mode can't do them (signing fingerprints, the Apple Team ID, the iOS Swift package).

If the command can't be used (no Node 18+, or the user says no), follow the manual steps in the platform's reference file instead.

Exit codes: 0 success, 1 problems found or a step failed, 2 cancelled, 3 sign-in failed.

## Step 4 (apps): Verify with doctor, then fix what fails

```sh
npx @clikgate/setup doctor --json --domain acme.ciz.to,go.acme.com
```

`doctor` changes nothing. With `--json`, stdout is one JSON document (human text goes to stderr), and it never signs in, so it runs the local checks only:

```json
{ "schema_version": 1, "command": "doctor", "cli_version": "…",
  "project": { "path": "…", "platform": "flutter" },
  "ok": false,
  "summary": { "passed": 9, "warnings": 1, "failed": 1, "skipped": 1 },
  "checks": [ { "id": "android.release_no_test_domain", "group": "project", "status": "fail",
                "title": "…", "detail": "…", "fix": "…", "doc_url": "…", "code": "…" } ],
  "next_steps": [ { "message": "…", "doc_url": null } ] }
```

- `ok` is true when no check has `status: "fail"`; the exit code is 0 exactly when `ok` is true. Warnings are allowed.
- For every check with `status` `fail` (then `warn`), apply its `fix`. Use [references/troubleshooting.md](references/troubleshooting.md) for each check `id`, show the change, then run doctor again. Repeat until `ok` is true.
- `skip` is normal for `clikgate.signed_in` with `--json`. The server-side checks (`clikgate.*`) and the first-event check (`live.first_event`) run only when the user runs `npx @clikgate/setup doctor` without `--json` in their own terminal and signs in.
- Pass on any `next_steps` messages.

Then ask the user to:

1. run a **debug** build of the app on a device or emulator (Expo: a new development build);
2. create a test link in the dashboard pointing to `clikgate-test:inspect`, and open it on the device. The app should open and receive the link;
3. optionally run `npx @clikgate/setup doctor` in their terminal, sign in, and wait for "Clikgate is receiving events from Android ✓" (or iOS).

**Manual checklist** (when the command wasn't used): the SDK dependency at version {{versions.flutter}}+ (Flutter), {{versions.react_native}}+ (React Native and Expo), {{versions.android}}+ (Android) or {{versions.ios}}+ (iOS); `Clikgate.configure` at start-up with the test key; app links for the app subdomain and every custom domain in release builds; the app's `*.dev.ciz.to` test subdomain in debug builds only; no shared domain anywhere; deep links forwarded to the SDK; the signing fingerprints (Android) and Team ID (iOS) added in the dashboard.

## Going live (the user's step)

Release builds need the live SDK key. The setup summary prints the file and line of the test key. Tell the user to put their live key there for release builds. Don't do it, and don't ask for the live key.

## Websites and servers

- **Website:** one script tag with the publishable web key (`data-web-key`), then `Clikgate.goal(…)` for goals that allow browser goals, and `Clikgate.clickId()`. See [references/web.md](references/web.md).
- **Sharing links from an app** (only when the user asks for share buttons, and only for apps without their own backend): the optional Engage add-on (`com.clikgate:clikgate-engage`, pod `Clikgate/Engage` or the `ClikgateEngage` Swift package product, `clikgate_engage`, `@clikgate/react-native-engage`) has `share.link(url, …)` and `share.referralLink(link, …)`. They open the phone's share menu, give each app its own version of the link and record the share. Never build or guess the link versions yourself; pass the link as it is, or the API's `share_urls`. React Native apps must be rebuilt after adding the package.
- **Identify users** (only when the user asks for sign-in identification, labels, or referrals and leaderboards that need a verified user): the app calls `identifyUser(label, customerId, identityToken)` after sign-in and at app open when signed in, and clears it on sign-out. **Path A (default):** the server adds one field to its sign-in and "current user" responses, made by `createIdentityToken(user.id)` (Node; the formula for other languages is in [references/server-sdks.md](references/server-sdks.md)) with `CLIKGATE_IDENTITY_SECRET` from the server's environment. **Path B** (no secret or token): the app sends `getInstallationId()` with its sign-in request and the server calls `identifyUser({ appId, installationId, customerId })`. See [references/goals.md](references/goals.md) and https://clikgate.com/docs/identify-users.
- **Server:** `@clikgate/node` is available now. The Python, PHP, Java and .NET SDKs are **not available yet**. Use the HTTP API for those, as [references/server-sdks.md](references/server-sdks.md) shows. Don't invent package names or install lines.

## Reference files

- [references/flutter.md](references/flutter.md), [references/react-native.md](references/react-native.md), [references/expo.md](references/expo.md), [references/android.md](references/android.md), [references/ios.md](references/ios.md): what the setup changes, the manual steps, and checks.
- [references/web.md](references/web.md): the web script.
- [references/server-sdks.md](references/server-sdks.md): server SDKs and the HTTP API.
- [references/goals.md](references/goals.md): sending the end goal from apps, websites and servers; private mode.
- [references/payments.md](references/payments.md): Payment goals. The same `goal()` call with `provider` and `reference` (no amount) in the checkout success callback, then a trusted confirmation: the server sends the goal with the value, or uses `payments.fromPaystack(...)` and the other helpers, right after its own verification.
- [references/test-links.md](references/test-links.md): test subdomain rules and test pages.
- [references/api-surface.md](references/api-surface.md): every public SDK method. Use nothing else.
- [references/troubleshooting.md](references/troubleshooting.md): doctor check IDs, API errors and fixes.
