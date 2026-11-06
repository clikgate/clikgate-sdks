# Native iOS

Package: the `Clikgate` pod (`pod 'Clikgate', '~> {{versions.ios_pod}}'`), or the Swift package `https://github.com/clikgate/clikgate-ios-sdk` from {{versions.ios}}. It requires iOS 13.

## What `npx @clikgate/setup` changes

| File | Change |
|---|---|
| `Podfile` | `pod 'Clikgate', '~> {{versions.ios_pod}}'` in the app target, then `pod install` when CocoaPods is available |
| no Podfile | a **manual step**: in Xcode, File › Add Package Dependencies…, enter `https://github.com/clikgate/clikgate-ios-sdk`, choose "Up to Next Major Version" from {{versions.ios}}, and add the `Clikgate` library to the app target. Until this is done, doctor fails `sdk.dependency`. Tell the user; you can't do it with a text edit |
| `<Target>.entitlements` | Release (and Profile): `applinks:` for each live domain |
| `<Target>Debug.entitlements` | Debug: the live domains plus `applinks:acme.dev.ciz.to` |
| `project.pbxproj` | `CODE_SIGN_ENTITLEMENTS` per build configuration |
| SwiftUI `@main App` | `init()` with `Clikgate.configure` and `Clikgate.shared.onDeepLink`; `.onOpenURL` and `.onContinueUserActivity` on the root view |
| UIKit | `didFinishLaunching`, plus `SceneDelegate` forwarding (or the AppDelegate URL methods without scenes) |

iOS changes aren't build-tested by Clikgate's CI. Ask the user to build once in Xcode.

## Manual steps (only if the command can't be used)

1. Add the dependency (CocoaPods or Swift Package Manager, as above).
2. SwiftUI:

   ```swift clikgate-check
   import SwiftUI
   import Clikgate

   @main
   struct MyApp: App {
       init() {
           // acme.dev.ciz.to (test links) only in Debug builds
           #if DEBUG
           let linkDomains = ["acme.ciz.to", "go.acme.com", "acme.dev.ciz.to"]
           #else
           let linkDomains = ["acme.ciz.to", "go.acme.com"]
           #endif
           Clikgate.configure(sdkKey: "cg_sdk_test_…", options: ClikgateOptions(linkDomains: linkDomains))
           Clikgate.shared.onDeepLink { link in
               // open the screen for link.path; link.data holds the link's data
               print("Clikgate deep link:", link.path ?? "/")
           }
       }

       var body: some Scene {
           WindowGroup {
               Text("Hello")
                   .onOpenURL { Clikgate.shared.handle(url: $0) }
                   .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { Clikgate.shared.continue(userActivity: $0) }
           }
       }
   }
   ```

   UIKit with scenes: call `Clikgate.configure` in `application(_:didFinishLaunchingWithOptions:)`, and forward links in the `SceneDelegate`, keeping any existing code there:

   ```swift
   func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options: UIScene.ConnectionOptions) {
       options.userActivities.forEach { Clikgate.shared.continue(userActivity: $0) }
       options.urlContexts.forEach { Clikgate.shared.handle(url: $0.url) }
   }
   func scene(_ scene: UIScene, continue userActivity: NSUserActivity) { Clikgate.shared.continue(userActivity: userActivity) }
   func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
       URLContexts.forEach { Clikgate.shared.handle(url: $0.url) }
   }
   ```

3. Associated Domains, per build configuration:
   - Release: `<Target>.entitlements` with `com.apple.developer.associated-domains` = `applinks:acme.ciz.to` and `applinks:go.acme.com` (one entry per live domain: the app's link subdomain and its custom domains).
   - Debug: `<Target>Debug.entitlements` with the same entries plus `applinks:acme.dev.ciz.to`.
   - Set `CODE_SIGN_ENTITLEMENTS` for each configuration to its file (target › Build Settings › Code Signing Entitlements).
   - Never add a `*.dev.ciz.to` test host to the Release file, and never a shared domain (`ciz.to`, `clk.ng`, `clkg.to`, `dev.ciz.to`) to any file: shared domains can't open the app.
4. In the dashboard (Apps › the app), add the Apple Team ID and bundle ID, so Clikgate serves the `apple-app-site-association` file.

Don't add App Tracking Transparency prompts or IDFA code: Clikgate doesn't use them.

## Check

`npx @clikgate/setup doctor --json --domain acme.ciz.to,go.acme.com` checks every configuration's entitlements (`ios.entitlements.<Config>`) and that release builds cover every live domain (`ios.release_domains`).

Payment goals: `Clikgate.shared.goal("order_paid", reference: reference, provider: .paystack)` in the gateway checkout's success callback; the completion gets `.waiting` until the payment is confirmed. Never pass an amount; a trusted source confirms the payment. See [payments.md](payments.md).
