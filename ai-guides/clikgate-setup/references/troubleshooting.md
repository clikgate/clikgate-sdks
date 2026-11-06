# Troubleshooting

## Doctor check IDs (`npx @clikgate/setup doctor --json`)

Each check has `id`, `status` (`pass`, `warn`, `fail`, `skip`), `title`, and optional `detail`, `fix`, `doc_url` and `code`. Apply the check's own `fix` first. This table says what to do for each `id`.

| `id` | When it fails or warns | What to do |
|---|---|---|
| `project.detected` | no project, or several | run from the app folder, or pass `--cwd <folder>` / `--platform <name>` |
| `sdk.dependency` | the Clikgate SDK isn't a dependency | rerun the setup command. Native iOS without a Podfile: the user adds the Swift package in Xcode (see [ios.md](ios.md)) |
| `sdk.version` | below the minimum | raise it to Flutter ^{{versions.flutter}}, React Native ^{{versions.react_native}}, Android {{versions.android}} or iOS ~> {{versions.ios_pod}} |
| `startup.code` | `Clikgate.configure(` not found | add the start-up code from the platform file. The command edits only recognised template shapes; otherwise it prints the snippet as a manual step |
| `sdk.key` | the warn "no cg_sdk_ key found": the key is read from elsewhere | fine if the app loads the test key from its own config |
| `sdk.key` | the title says "Live SDK key in use" | put the **test** key in debug builds. Tell the user that the live key is for release builds and is their step. Don't write it yourself |
| `android.release_no_test_domain` | a test host (`acme.dev.ciz.to`) is in a release manifest | move that intent filter from `src/main` to `src/debug/AndroidManifest.xml` |
| `android.debug_test_domain` | the app's test subdomain (`acme.dev.ciz.to`) is missing from debug builds | add the debug filter ([android.md](android.md) step 3) |
| `android.release_domains` | a live domain is missing from release builds | add a `<data android:host>` for it in `src/main`, or pass the right `--domain` list |
| `ios.entitlements.<Config>` | missing file, invalid plist, a `*.dev.ciz.to` test host in a release configuration, or no domains | Debug: live domains + `applinks:acme.dev.ciz.to`. Release/Profile: live domains only. Each configuration's `CODE_SIGN_ENTITLEMENTS` must point to an existing file |
| `ios.release_domains` | a live domain is missing from release entitlements | add `applinks:<domain>` to the Release file |
| `expo.plugin` | the plugin is missing, a `*.dev.ciz.to` test host is in `linkDomains`, or the config is `app.config.*` | add `["@clikgate/react-native", {"linkDomains": ["acme.ciz.to", ...], "testLinkDomain": "acme.dev.ciz.to"}]`. For `app.config.*`, edit it by hand |
| `android.shared_domains`, `ios.shared_domains`, `expo.shared_domains` | warns "remove this: shared domains can't open your app": a shared domain (`ciz.to`, `clk.ng`, `clkg.to`, `dev.ciz.to`) is still in the manifests, entitlements or plugin entry | show the user the lines, then remove them. The app subdomain (`acme.ciz.to`, debug `acme.dev.ciz.to`) and custom domains open the app; links on shared domains keep working through the browser and the store |
| `clikgate.signed_in` | `skip` with `--json` | normal: server checks need the user's own `npx @clikgate/setup doctor` with sign-in |
| `clikgate.<android\|ios>.app` | no Clikgate app matches the package name or bundle ID | create or fix the app in the dashboard (Apps) |
| `clikgate.<android\|ios>.link_subdomain` | the app's link subdomain isn't confirmed (`code` `link_subdomain_not_confirmed`) | the user confirms it in the dashboard (Apps › the app › Link subdomain) or reruns the setup in their terminal |
| `clikgate.android.fingerprints` | no SHA-256 fingerprint | the user adds the debug and Play App Signing fingerprints in the dashboard |
| `clikgate.ios.team_id` | no Team ID | the user adds the Apple Team ID in the dashboard |
| `clikgate.domain.<host>.<aasa\|assetlinks>` | the app-links file of the app subdomain (`acme.ciz.to`, `acme.dev.ciz.to`) or a custom domain doesn't list this app | see the `code` table below |
| `clikgate.sdk.<warning code>` | a server-side SDK warning | follow its `fix` |
| `clikgate.setup_check` | the server check couldn't run | network or sign-in: retry later |
| `live.first_event` | no event within 5 minutes | run a **debug** build with the test key, check the device has network, then retry |

### `code` values on `clikgate.domain.*` checks

| `code` | Fix |
|---|---|
| `domain_not_active` | finish the domain setup in the dashboard (Domains) |
| `unreachable`, `not_served`, `redirected`, `invalid_json` | the domain isn't serving its app-links file correctly. Check the DNS record in the dashboard; nothing to change in the app |
| `missing_team_id` / `missing_fingerprints` | add the Team ID / the SHA-256 fingerprints in the dashboard |
| `app_not_listed` | the app isn't attached to this domain: check the app's link domains in the dashboard |
| `wrong_fingerprint` | the fingerprint doesn't match the build. With Play App Signing, use the one from Play Console › Release › Setup › App signing |
| `link_subdomain_not_confirmed` | the app's link subdomain is only a suggestion: the user confirms it in the dashboard (Apps › the app › Link subdomain), or reruns `npx @clikgate/setup` in their terminal and confirms it there |

## Common problems

| Problem | Cause and fix |
|---|---|
| App Links don't verify (Android) | the fingerprint is missing or wrong in the dashboard (Play App Signing!), or a host in the filter isn't set up: on Android 11 and lower one bad host fails them all. Check with `adb shell pm get-app-links <applicationId>` |
| Links on `ciz.to`, `clk.ng`, `clkg.to` or `dev.ciz.to` open the browser, not the app | expected: shared domains can't open any app. Use the app subdomain (`acme.ciz.to`, or `acme.clk.ng` on the Free plan) or a custom domain for links that should open the app |
| `acme.clk.ng` in the project, and you wonder if it is a shared domain | it isn't: it is the app's own subdomain on the Free plan, so keep it in release builds. Only the bare `clk.ng` is a shared domain |
| The app logs "needs Growth" once, and goals or events don't appear | expected on Free and Starter: install attribution, events and goals need Growth. Deep links still work. Keep the calls: they start counting after an upgrade, with no code change |
| A new install opens the home screen instead of the link's screen | on Free and Starter the monthly deferred deep link allowance (1,000 / 10,000) is used: the SDK gets the normal "no deferred link" result until next month. Direct deep links still work |
| Universal Links don't open the app (iOS) | missing Associated Domains for that configuration, a wrong Team ID or bundle ID in the dashboard, or the app was installed before the entitlement was added: reinstall |
| Expo: links don't open after the change | the user needs a **new development build**; Expo Go and old builds keep the old config |
| Test links open the release build, or not at all | the test link must be on the app's test subdomain (`acme.dev.ciz.to`, not the shared `dev.ciz.to`), and that host must be in debug builds only: install a debug build to test |
| The setup command refuses the key | it was a live key (`cg_sdk_live_…`). Use the test key from the dashboard |
| `422 test_destination_not_allowed` | the test link points to a site that isn't allowed. Use a test page (`clikgate-test:inspect`), a verified site, a local address or a verified tunnel ([test-links.md](test-links.md)) |
| `422 domain_mode_mismatch` | a test link on a live domain, or a live link on a `*.dev.ciz.to` test domain |
| `403 test_link_limit_reached` | 200 active test links: archive old ones |
| `422 private_mode_field_rejected` | the organisation uses private mode: remove the named field ([goals.md](goals.md)) |
| `422 payment_goal_needs_confirmation` | a Payment goal sent from a website or app without `provider` or `reference` (`missing` lists them): add them to the `goal()` call ([payments.md](payments.md)) |
| `422 unknown_provider` | the provider isn't in Clikgate's gateway list: use the SDK's `Provider` enum, or check `GET /v1/payment-gateways` |
| `422 value_required` / `code_not_supported` on a Payment goal from the server | send the confirmed `value` (above 0) and `click_id`, not `code` |
| `403 plan_feature_unavailable` | Payment goals and payment confirmations need Starter or above: the user upgrades in the dashboard |
| `422 rule_targets_payment_goal` | an app event rule can't count a Payment goal: Payment goals are confirmed by the payment provider or server |
| `403 cli_scope` | the setup command can't do this: use the dashboard, https://app.clikgate.com |
| Package install failed during setup | rerun with `--no-install`, then the user runs `flutter pub get` / `npm install` / `pod install` themselves |
| `Use the test key; switch to live for release builds.` | offline mode got a live key: use `cg_sdk_test_…` |
