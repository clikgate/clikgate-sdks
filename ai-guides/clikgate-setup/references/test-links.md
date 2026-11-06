# Test links (`*.dev.ciz.to`)

Test-mode links (made with the test API key, or in the dashboard's test mode) use the app's **test subdomain** `<link_subdomain>.dev.ciz.to` (for example `acme.dev.ciz.to`), or the shared test domain `dev.ciz.to`. Live links never use them, and test links never use a live domain (`422 domain_mode_mismatch`). Test clicks never reach live analytics, billing or ad platforms.

Only the app's own test subdomain opens the app: `dev.ciz.to` is shared by every organisation, so it can't open anyone's app (its links go through the browser and the store). Test links that should open a debug build use `acme.dev.ciz.to`; the dashboard picks it by default for test links with app routing.

## The test subdomain in apps: debug builds only

- Android: `src/debug/AndroidManifest.xml` (and other debug-based source sets), never `src/main`.
- iOS: the Debug entitlements file only.
- Expo: `testLinkDomain`, never `linkDomains`.
- Code: behind `kDebugMode` (Dart), `__DEV__` (JS), `FLAG_DEBUGGABLE` (Android) or `#if DEBUG` (Swift).
- Never `dev.ciz.to` itself, in any build: doctor warns "remove this: shared domains can't open your app".

`npx @clikgate/setup` does this. Doctor fails `android.release_no_test_domain`, `ios.entitlements.Release` or `expo.plugin` if a test host reaches a release build.

## Where a test link may point

Anything else is refused with `422 test_destination_not_allowed`. The error lists `allowed` (`clikgate_test_page`, `verified_site`, `local_address`, `verified_tunnel`) and a `doc_url`.

1. **Clikgate test pages.** Use the shorthand `clikgate-test:<page>`, or the full URL `https://dev.ciz.to/_t/<page>`:

   | Shorthand | Page |
   |---|---|
   | `clikgate-test:inspect` | Click inspector: shows the click ID, link, UTM and query parameters, device and time |
   | `clikgate-test:checkout` | A fake "Pay ₦5,000 (test)" page that sends a test goal for the click |
   | `clikgate-test:app-open` | Tries to open the organisation's apps and reports what happened |
   | `clikgate-test:store` | A simulated store page, for testing deferred deep links |

2. **The organisation's verified websites** and their subdomains. Verify a site in the dashboard, or with `POST /v1/verified-sites`. There are two methods:
   - DNS: a TXT record `_clikgate-verify.<host>` = `cg-site=<token>`;
   - file: `https://<host>/.well-known/clikgate-verify.txt` containing the token.

   Verification lasts 90 days.
3. **The developer's own computer or Wi-Fi.** These are the only destinations allowed over `http://`:
   - `localhost`, `*.localhost`, `127.0.0.0/8` and `[::1]`;
   - private ranges `10.0.0.0/8`, `172.16.0.0/12` and `192.168.0.0/16`, and `*.local`.

   From a phone on the same Wi-Fi, use the computer's Wi-Fi address (for example `http://192.168.1.20:3000`). From the Android emulator, use `http://10.0.2.2:<port>`.
4. **Verified tunnels** (ngrok, Cloudflare Tunnel, localtunnel and similar): only after the file method succeeds for that exact host name. It lasts 7 days.

Never point a test link at a site the organisation doesn't own.

## Limits

- 500 test clicks per organisation per day. After that, links show "Daily test limit reached".
- At most 200 active test links (`403 test_link_limit_reached`).
- Test links expire 30 days after creation.

If a browser asks for permission to reach devices on the local network when a test link redirects to a local address, allow it. Otherwise open the local address directly. Details: https://clikgate.com/docs/test-mode
