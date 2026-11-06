# Flutter

Package: `clikgate_flutter` ^{{versions.flutter}}. It requires Flutter 3.24+, Android minSdk 21 and iOS 13.

## What `npx @clikgate/setup` changes

| File | Change |
|---|---|
| `pubspec.yaml` | `clikgate_flutter: ^{{versions.flutter}}` under `dependencies:`, then `flutter pub get` |
| `lib/main.dart` | imports; `main` becomes `Future<void> main() async`; `WidgetsFlutterBinding.ensureInitialized()` and `await Clikgate.configure(...)` before `runApp` |
| `android/app/src/main/AndroidManifest.xml` | on the launcher activity: `flutter_deeplinking_enabled=false` and a verified `https` intent filter for the live domains |
| `android/app/src/debug/AndroidManifest.xml` | a verified intent filter for the app's test subdomain (`acme.dev.ciz.to`, debug builds only) |
| `ios/Runner/Runner.entitlements` | Release and Profile: `applinks:<live domain>` for each live domain |
| `ios/Runner/RunnerDebug.entitlements` | Debug: the live domains plus `applinks:acme.dev.ciz.to` |
| `ios/Runner.xcodeproj/project.pbxproj` | `CODE_SIGN_ENTITLEMENTS` per build configuration |
| `ios/Runner/Info.plist` | `FlutterDeepLinkingEnabled=false` |

Inserted code sits between `// clikgate-setup:start` and `// clikgate-setup:end` (`<!-- -->` in XML). iOS link forwarding needs no Swift changes: Flutter's scene delegate forwards links to the plugin.

## Manual steps (only if the command can't be used)

1. `pubspec.yaml`:

   ```yaml
   dependencies:
     clikgate_flutter: ^{{versions.flutter}}
   ```

2. `lib/main.dart`. Replace `acme.ciz.to` and `go.acme.com` with the live domains (the app's link subdomain and its custom domains), and keep the rest of `main` as it is:

   ```dart clikgate-check
   import 'package:flutter/foundation.dart' show kDebugMode;
   import 'package:flutter/material.dart';
   import 'package:clikgate_flutter/clikgate_flutter.dart';

   Future<void> main() async {
     WidgetsFlutterBinding.ensureInitialized();
     await Clikgate.configure(
       sdkKey: 'cg_sdk_test_…',
       // acme.dev.ciz.to (test links) only in debug builds
       linkDomains: ['acme.ciz.to', 'go.acme.com', if (kDebugMode) 'acme.dev.ciz.to'],
     );
     runApp(const MaterialApp(home: SizedBox()));
   }
   ```

3. Listen to deep links in the root widget's `initState`. Links that arrive before the first listener are replayed to it. Route with the app's existing router; don't replace it.

   ```dart
   Clikgate.onDeepLink.listen((ClikgateDeepLink link) {
     // open the screen for link.path; link.data holds the link's data
   });
   ```

4. Android, `android/app/src/main/AndroidManifest.xml`, inside the launcher `<activity>`. Keep the existing filters:

   ```xml
   <meta-data android:name="flutter_deeplinking_enabled" android:value="false" />
   <intent-filter android:autoVerify="true">
       <action android:name="android.intent.action.VIEW" />
       <category android:name="android.intent.category.DEFAULT" />
       <category android:name="android.intent.category.BROWSABLE" />
       <data android:scheme="https" />
       <data android:host="acme.ciz.to" />
       <data android:host="go.acme.com" />
   </intent-filter>
   ```

   Then `android/app/src/debug/AndroidManifest.xml`, inside `<application>`:

   ```xml
   <activity android:name=".MainActivity">
       <intent-filter android:autoVerify="true">
           <action android:name="android.intent.action.VIEW" />
           <category android:name="android.intent.category.DEFAULT" />
           <category android:name="android.intent.category.BROWSABLE" />
           <data android:scheme="https" />
           <data android:host="acme.dev.ciz.to" />
       </intent-filter>
   </activity>
   ```

5. iOS: Associated Domains. Give Release and Profile one entitlements file with `applinks:acme.ciz.to` and `applinks:go.acme.com`. Give Debug a separate file with the same entries plus `applinks:acme.dev.ciz.to`. Point each configuration's `CODE_SIGN_ENTITLEMENTS` at its file (Xcode › Runner target › Build Settings › Code Signing Entitlements, per configuration). Add `FlutterDeepLinkingEnabled` = `NO` to `ios/Runner/Info.plist`.

6. In the dashboard (Apps › the app), add the Android SHA-256 signing fingerprints (the debug keystore, plus the Play App Signing key from Play Console › Release › Setup › App signing) and the Apple Team ID.

## Check

- `npx @clikgate/setup doctor --json --domain acme.ciz.to,go.acme.com`
- On a device: `adb shell pm get-app-links <applicationId>` should show each live domain as `verified`.

Goals: [goals.md](goals.md). Methods: [api-surface.md](api-surface.md).

Payment goals: `await Clikgate.goal('order_paid', reference: reference, provider: ClikgateProvider.paystack)` in the gateway checkout's success callback; it completes with `GoalStatus.waiting` until the payment is confirmed. Never pass an amount; a trusted source confirms the payment. See [payments.md](payments.md).
