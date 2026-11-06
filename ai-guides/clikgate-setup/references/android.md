# Native Android

Artifact: `com.clikgate:clikgate-android:{{versions.android}}` (Maven Central), minSdk 21. The AAR ships its own R8 rules.

## What `npx @clikgate/setup` changes

| File | Change |
|---|---|
| `app/build.gradle(.kts)` | `implementation("com.clikgate:clikgate-android:{{versions.android}}")`, or a `libs.versions.toml` entry plus `implementation(libs.clikgate.android)` |
| `app/src/main/AndroidManifest.xml` | a verified `https` intent filter for the live domains on the launcher activity |
| `app/src/debug/AndroidManifest.xml` (and other debug-based source sets) | the app's test subdomain (`acme.dev.ciz.to`), debug builds only |
| the `Application` class | `Clikgate.configure(...)` and `Clikgate.onDeepLink { }` in `onCreate` after `super.onCreate()`. Without an `Application` class, it creates `ClikgateApplication.kt` and registers it with `android:name` |
| `MainActivity` | `Clikgate.handleIntent(this, intent)` in `onCreate`, and an `onNewIntent` override |

## Manual steps (only if the command can't be used)

1. Dependency (`app/build.gradle.kts`):

   ```kotlin
   dependencies {
       implementation("com.clikgate:clikgate-android:{{versions.android}}")
   }
   ```

2. `Application.onCreate`. Debug detection uses `FLAG_DEBUGGABLE`, because AGP 8 doesn't generate `BuildConfig` by default:

   ```kotlin clikgate-check
   import android.app.Application
   import android.content.pm.ApplicationInfo
   import android.util.Log
   import com.clikgate.Clikgate
   import com.clikgate.ClikgateOptions

   class MyApp : Application() {
       override fun onCreate() {
           super.onCreate()
           // acme.dev.ciz.to (test links) only in debug builds
           val debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
           val linkDomains = if (debuggable) listOf("acme.ciz.to", "go.acme.com", "acme.dev.ciz.to") else listOf("acme.ciz.to", "go.acme.com")
           Clikgate.configure(this, sdkKey = "cg_sdk_test_…", options = ClikgateOptions(linkDomains = linkDomains))
           Clikgate.onDeepLink { link ->
               // open the screen for link.path; link.data holds the link's data
               Log.i("Clikgate", "Deep link: ${link.path}")
           }
       }
   }
   ```

   Register it in the manifest with `android:name=".MyApp"`, unless the app already has an `Application` class (then add the lines to it).

3. Manifests. In `src/main/AndroidManifest.xml`, on the activity that receives links, keep its existing filters and add:

   ```xml
   <intent-filter android:autoVerify="true">
       <action android:name="android.intent.action.VIEW" />
       <category android:name="android.intent.category.DEFAULT" />
       <category android:name="android.intent.category.BROWSABLE" />
       <data android:scheme="https" />
       <data android:host="acme.ciz.to" />
       <data android:host="go.acme.com" />
   </intent-filter>
   ```

   In `src/debug/AndroidManifest.xml`, add the same filter with `<data android:host="acme.dev.ciz.to" />`, on an `<activity android:name=".MainActivity">` element inside `<application>`. The manifests merge by activity name.
   - With several live domains, add one `<data android:host>` per domain.
   - On Android 11 and lower, every host in the filter must verify, so leave out any domain that isn't set up for this app.

4. `MainActivity`:

   ```kotlin
   override fun onCreate(savedInstanceState: Bundle?) {
       super.onCreate(savedInstanceState)
       Clikgate.handleIntent(this, intent)          // cold start
   }

   override fun onNewIntent(intent: Intent) {
       super.onNewIntent(intent)
       setIntent(intent)
       Clikgate.handleIntent(this, intent)          // warm start
   }
   ```

5. In the dashboard (Apps › the app), add the SHA-256 fingerprints. Get the debug one with `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android`. With Play App Signing, get the release one from Play Console › Release › Setup › App signing, because the local keystore's fingerprint won't match users' devices.

## Check

- `npx @clikgate/setup doctor --json --domain acme.ciz.to,go.acme.com`
- On a device:

  ```sh
  adb shell pm verify-app-links --re-verify <applicationId>
  adb shell pm get-app-links <applicationId>        # each live domain: verified
  ```

Payment goals: `Clikgate.goal("order_paid", reference = reference, provider = Provider.PAYSTACK)` in the gateway checkout's success callback; `onResult` gets `GoalStatus.WAITING` until the payment is confirmed. Never pass an amount; a trusted source confirms the payment. See [payments.md](payments.md).
