# Expo

Package: `@clikgate/react-native` ^{{versions.react_native}}, with its config plugin. Expo Go can't load the native module, so the app needs a **development build**.

## What `npx @clikgate/setup` changes

| File | Change |
|---|---|
| `package.json` | `"@clikgate/react-native": "^{{versions.react_native}}"`, then the package manager install |
| `app.json` | `plugins` += `["@clikgate/react-native", {"linkDomains": ["acme.ciz.to", ...], "testLinkDomain": "acme.dev.ciz.to"}]` |
| `app.config.js` / `app.config.ts` | not edited, because they're code: the plugin entry is a manual step |
| `src/app/_layout.tsx`, `app/_layout.tsx` (Expo Router) or `App.tsx` | `Clikgate.configure(...)` at module level, and `Clikgate.onDeepLink` in a `useEffect` |
| `android/`, `ios/` (only when they exist, after `expo prebuild`) | the same native edits as React Native |

## The config plugin

```json
{
  "expo": {
    "plugins": [
      ["@clikgate/react-native", { "linkDomains": ["acme.ciz.to", "go.acme.com"], "testLinkDomain": "acme.dev.ciz.to" }]
    ]
  }
}
```

- `linkDomains`: the **live** domains only. Putting a `*.dev.ciz.to` test host in `linkDomains` is an error (doctor check `expo.plugin` fails), and a shared domain (`ciz.to`, `clk.ng`, `clkg.to`, `dev.ciz.to`) gets the warning `expo.shared_domains`.
- `testLinkDomain`: added to Android debug source sets and the iOS Debug configuration only.
- `testVariants` (default `["development", "preview"]`): builds whose `APP_VARIANT` (else EAS Build's `EAS_BUILD_PROFILE`) is listed get the test domain in every configuration, so internal preview builds open test links too. Set the variant per profile in `eas.json`:

  ```json
  { "build": { "development": { "env": { "APP_VARIANT": "development" } }, "preview": { "env": { "APP_VARIANT": "preview" } }, "production": {} } }
  ```

- The plugin doesn't touch the AppDelegate: Expo already forwards links to `RCTLinkingManager`, which the module observes.

## Start-up code

The same code as [react-native.md](react-native.md) step 2, placed in the root layout (`src/app/_layout.tsx` or `app/_layout.tsx`) or in `App.tsx`. Keep Expo Router's own linking.

## After any plugin change

Tell the user to **make a new development build**: `npx expo run:android` / `npx expo run:ios`, or `eas build --profile development`. Existing builds and Expo Go keep their old intent filters and entitlements.

## Manual steps (only if the command can't be used)

1. `npm install @clikgate/react-native@^{{versions.react_native}}` (or the project's package manager). `testLinkDomain` needs 1.4.0 or newer.
2. Add the plugin entry above to `app.json` (or to the `plugins` array of `app.config.*`).
3. Add the start-up code.
4. In the dashboard, add the Android SHA-256 fingerprints and the Apple Team ID.
5. Make a new development build.

## Check

`npx @clikgate/setup doctor --json --domain acme.ciz.to,go.acme.com` checks the dependency, the start-up code and the plugin entry (and the native folders, if they exist).
