# React Native (bare)

Package: `@clikgate/react-native` ^{{versions.react_native}}. The native modules autolink: Android depends on `com.clikgate:clikgate-android`, and iOS on the `Clikgate` pod. For Expo, see [expo.md](expo.md).

## What `npx @clikgate/setup` changes

| File | Change |
|---|---|
| `package.json` | `"@clikgate/react-native": "^{{versions.react_native}}"`, then the project's package manager install (npm, yarn, pnpm or bun) and `pod install` when CocoaPods is available |
| `App.tsx` / `App.js` | after the imports: `Clikgate.configure({...}).catch(console.warn)`. Inside `App`: a `useEffect` with `Clikgate.onDeepLink(...)` |
| `android/app/src/main/AndroidManifest.xml` | a verified `https` intent filter for the live domains on `MainActivity` |
| `android/app/src/debug/AndroidManifest.xml` (and `debugOptimized` when present) | the app's test subdomain (`acme.dev.ciz.to`), debug builds only |
| `ios/<Target>/<Target>.entitlements` | Release: `applinks:` for each live domain |
| `ios/<Target>/<Target>Debug.entitlements` | Debug: the live domains plus `applinks:acme.dev.ciz.to` |
| `ios/<Target>.xcodeproj/project.pbxproj` | `CODE_SIGN_ENTITLEMENTS` per configuration |

iOS link forwarding: the current template's `SceneDelegate` forwards links to `RCTLinkingManager`, which the module observes. Other shapes get a manual step (below).

## Manual steps (only if the command can't be used)

1. Install: `npm install @clikgate/react-native@^{{versions.react_native}}` (or the project's package manager), then `cd ios && pod install`.
2. Configure once, at module level in `App.tsx` (or in `index.js` before `AppRegistry.registerComponent`):

   ```ts clikgate-check
   import { useEffect } from 'react';
   import { Clikgate } from '@clikgate/react-native';

   Clikgate.configure({
     sdkKey: 'cg_sdk_test_…',
     // acme.dev.ciz.to (test links) only in development builds
     linkDomains: __DEV__ ? ['acme.ciz.to', 'go.acme.com', 'acme.dev.ciz.to'] : ['acme.ciz.to', 'go.acme.com'],
   }).catch(console.warn);

   export function useClikgateLinks(): void {
     useEffect(
       () =>
         Clikgate.onDeepLink((link) => {
           // open the screen for link.path; link.data holds the link's data
           console.log('Clikgate deep link', link.path);
         }),
       []
     ); // onDeepLink returns the unsubscribe function
   }
   ```

   Call the effect in the root component. Keep the app's existing navigation and `Linking` handling.
3. Android manifests: the same filters as [android.md](android.md) step 3. The live domains go in `src/main`, and the test subdomain `acme.dev.ciz.to` goes in `src/debug/AndroidManifest.xml` on `.MainActivity`. Intent forwarding is automatic: don't edit `MainActivity`.
4. iOS: Associated Domains, with Release getting the live domains only and Debug the live domains plus `applinks:acme.dev.ciz.to`, as in [ios.md](ios.md) step 3. If the app has a custom `AppDelegate`/`SceneDelegate` that doesn't forward to `RCTLinkingManager`, forward to the module:

   ```swift
   import ClikgateReactNative

   func application(_ app: UIApplication, open url: URL,
                    options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
     let clikgate = ClikgateRN.handle(url: url)
     return RCTLinkingManager.application(app, open: url, options: options) || clikgate
   }

   func application(_ application: UIApplication, continue userActivity: NSUserActivity,
                    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
     let clikgate = ClikgateRN.continue(userActivity: userActivity)
     return RCTLinkingManager.application(application, continue: userActivity,
                                          restorationHandler: restorationHandler) || clikgate
   }
   ```

5. In the dashboard, add the Android SHA-256 fingerprints (debug and Play App Signing) and the Apple Team ID.

## Check

`npx @clikgate/setup doctor --json --domain acme.ciz.to,go.acme.com`, then run a debug build and open a test link.

Goals: [goals.md](goals.md). Methods: [api-surface.md](api-surface.md).

Payment goals: `await Clikgate.goal('order_paid', { reference, provider: ClikgateProvider.Paystack })` in the gateway checkout's success callback; it resolves with `GoalStatus.Waiting` until the payment is confirmed. Never pass an amount; a trusted source confirms the payment. See [payments.md](payments.md).
