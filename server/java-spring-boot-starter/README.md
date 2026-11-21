# com.clikgate:clikgate-spring-boot-starter

Spring Boot 4 (Java 17+) auto-configuration for [`com.clikgate:clikgate-java`](https://github.com/clikgate/clikgate-sdks/blob/main/server/java/README.md):

- a `Clikgate` bean from `clikgate.*` properties (closed with the context, which flushes queued goals);
- the click-ID servlet filter;
- `@ClikgateClickId String clickId` handler parameters;
- `@ClikgateInstallation Installation installation` handler parameters (the app's `Clikgate-Installation` header, for `identifyUser`; null when missing or invalid, never an error);
- `ClikgateContext.currentClickId()`;
- the `/cg/keep` route, when `clikgate.keep-route.enabled=true`.

```xml
<dependency>
  <groupId>com.clikgate</groupId>
  <artifactId>clikgate-spring-boot-starter</artifactId>
  <version>2.1.0</version>
</dependency>
```

```properties
clikgate.api-key=${CLIKGATE_API_KEY}
```

The bean is the full client, so payment confirmations work as in the Java SDK. Call them right after your own
verification with the gateway:

```java
@PostMapping("/paystack/verified")
void verified(@RequestBody String paystackVerifyBody) {   // the body your server got from Paystack's verify call
  clikgate.payments().fromPaystack(paystackVerifyBody);
}
```

## Identify your users

Full guide: https://clikgate.com/docs/identify-users. **Path A (default):** the bean signs identity tokens with no network call; return one in your sign-in and "current user" responses, and the app passes it to the mobile SDK's `identifyUser()`. The secret stays on the server:

```properties
clikgate.identity-secret=${CLIKGATE_IDENTITY_SECRET}
# several apps, by app ID:
# clikgate.identity-secrets.app_shop=${SHOP_IDENTITY_SECRET}
```

```java
@GetMapping("/me")
Map<String, Object> me(@AuthenticationPrincipal AppUser user) {
  return Map.of("user", user, "clikgateIdentityToken", clikgate.createIdentityToken(user.getId()));
}
```

**Path B: the installation header, no secret or token.** The mobile SDK gives your app a `Clikgate-Installation` header (`<app_id>:<installation_id>`, not a secret), which the app sends to your server with its sign-in request and signed-in requests. After your own sign-in check succeeds, and at every signed-in app open, pass it to `clikgate.identifyUser(...)` as `installation` with your signed-in user's ID. Your server never needs to know which Clikgate app ID belongs to which platform. Clikgate accepts installations active in the last 7 days.

- **The customer ID always comes from your own authenticated user.** The header only names the app installation. Call `clikgate.identifyUser(...)` only after your sign-in check succeeds, and never read the customer ID from the request.
- **A missing or invalid header is ignored** (`null`, never an error or a log line): skip the call. Parsing is strict: `app_…`, one colon, a lowercase UUID, at most 128 characters, trimmed.
- **`appId` is optional.** With only an installation ID, Clikgate finds the app. If the same installation ID is active in several of your apps (iOS apps sharing a Keychain access group can share one), the API answers `409 installation_in_several_apps`, a `ConflictException` with param `app_id`: send `appId` too.

```java
@PostMapping("/login")
Session login(@RequestBody Credentials credentials, @ClikgateInstallation Installation installation) {
  User user = auth.signIn(credentials);   // your own sign-in check first
  if (installation != null) {
    clikgate.identifyUser(IdentifyUserParams.builder().installation(installation).customerId(user.getId()).build());
  }
  return Session.of(user);
}
```

See the [Java SDK](../java/README.md#identify-your-users).

## End to end: a typed backend

Every call below goes through the `Clikgate` bean and returns a typed model with getters: no `Map` results and no casts. `clikgate.referrals()`, `people()`, `installs()`, `codes()` and `privacy()` are on the bean too (see the [Java SDK](../java/README.md#referrals-people-installs-codes-and-privacy)).

```java
@RestController
class AppController {
  private static final String PROGRAM = "rpg_01J…";   // Referrals › your program
  private final Clikgate clikgate;

  AppController(Clikgate clikgate) {
    this.clikgate = clikgate;
  }

  // 1. Sign-in: return an identity token (path A) and, if the app sent its installation header, identify the user (path B).
  @PostMapping("/login")
  Map<String, Object> login(@RequestBody Credentials credentials, @ClikgateInstallation Installation installation) {
    User user = auth.signIn(credentials);   // your own sign-in check first
    if (installation != null) {
      clikgate.identifyUser(IdentifyUserParams.builder().installation(installation).customerId(user.getId()).build());
    }
    return Map.of("user", user, "clikgateIdentityToken", clikgate.createIdentityToken(user.getId()));
  }

  // 2. "Invite friends": the user's referral code and link, created on first call.
  @GetMapping("/me/referral")
  Map<String, Object> referral(@AuthenticationPrincipal User user) {
    Referrer referrer = clikgate.referrals().getOrCreateReferrer(PROGRAM, user.getId());
    return Map.of("code", referrer.getCode(), "url", referrer.getUrl(), "qualified", referrer.getStats().getQualified());
  }

  // 3. A goal, from your server.
  @PostMapping("/orders/{id}/placed")
  void orderPlaced(@PathVariable String id) {
    clikgate.goal("first_order", Goal.builder().reference(id).value(new BigDecimal("1500.50")).currency("NGN").build());
  }

  // 4. A payment your server verified with the gateway.
  @PostMapping("/paystack/verified")
  void paid(@RequestBody String paystackVerifyBody) {
    PaymentConfirmation confirmation = clikgate.payments().fromPaystack(paystackVerifyBody);   // null: not a payment to report
    if (confirmation != null) {
      log.info("payment {} is {}", confirmation.getReference(), confirmation.getStatus());
    }
  }

  // 5. Webhooks: verify the raw bytes, then read the typed object.
  @PostMapping("/webhooks/clikgate")
  void webhook(@RequestBody byte[] body, @RequestHeader("Clikgate-Signature") String signature) {
    WebhookEvent event = Webhooks.verify(body, signature, System.getenv("CLIKGATE_WEBHOOK_SECRET"));
    if (EventType.REFERRAL_QUALIFIED.equals(event.getType())) {
      Referral referral = event.asReferral();   // non-null: the type is referral.qualified
      rewards.credit(referral.getReferrer().getCustomerId(), referral.getReferee().getCustomerId(), referral.getId());
    }
  }
}
```

- `getOrCreateReferrer(programId, customerId)` is the short form of `getOrCreateReferrer(programId, GetOrCreateReferrerParams.builder().customerId(…).displayName(…).externalCode(…).build())`. `referrer.isCreated()` is true when this call created it.
- `event.asReferral()`, `asReferrer()`, `asGoalEvent()`, `asInstall()`, `asPayment()`, `asConversion()` and `asDeviceChange()` read `data.object` typed. Each returns `null` (`@Nullable`) when the event belongs to another family, never a wrong object. `EventType` constants are strings, so they also work with `equals` and in a `switch`.
- Money in responses: `amountMinor` stays the wire's minor units, and `getAmount()` is the same amount as an exact `BigDecimal` in normal units (`50000` NGN is `500.00`, `1500` JPY is `1500`).

## Customers from before Clikgate

Tell Clikgate who was already your customer before you added it, so they are never counted as a referral or a new customer. Send the account's creation date with the identity token (version 2) or from your server, and import the rest of your existing customers once. Use your own customer IDs, never emails or phone numbers: Clikgate stores a keyed fingerprint of each imported ID, not the ID itself. Not available in private mode. Guide: https://clikgate.com/docs/identify-users.

```java
String token = clikgate.createIdentityToken(user.getId(), null, user.getCreatedAt()); // version 2 (an Instant); null → version 1
clikgate.knownCustomers().importCustomers(Collections.singletonList(KnownCustomer.of("u_10482", LocalDate.of(2024, 3, 2))));
```

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

The filter already persists a `?cgid=…` on every page, with the `_cg_kept=s` marker. For pages Spring doesn't render (a static or cached landing page), turn on the `/cg/keep` route and add `data-server-endpoint="/cg/keep"` to the web script:

```properties
# application.properties: the filter persists ?cgid=… on every page (on by default); the route is off unless enabled
clikgate.cookie.days=90
clikgate.keep-route.enabled=true      # POST /cg/keep (clikgate.keep-route.path to change it)
```

```java
// With Spring Security: the web script has no CSRF token, so exclude the route from CSRF and permit it
@Bean
SecurityFilterChain security(HttpSecurity http) throws Exception {
  http.csrf(csrf -> csrf.ignoringRequestMatchers("/cg/keep"))
      .authorizeHttpRequests(auth -> auth.requestMatchers("/cg/keep").permitAll().anyRequest().authenticated());
  return http.build();
}
```

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_test_…" data-server-endpoint="/cg/keep" async></script>
```

- `clikgate.keep-route.enabled` is **false by default**, so no route appears unless you ask for it. `clikgate.keep-route.path` changes the path (default `/cg/keep`); `clikgate.keep-route.secure=false` drops `Secure` (only for plain `http://localhost` while developing). The lifetime is `clikgate.cookie.days` (1 to 400) and the domain `clikgate.cookie.domain`.
- **Same server only.** The route must be served by the same host as the website (same scheme, host and port), because the cookie is first-party. It accepts only a same-origin `POST` (`Sec-Fetch-Site: same-origin`, else an `Origin` equal to the host), a JSON body of at most 1 KB with the same valid click ID in `click_id` and `page_click_id`, and answers `204` with `Cache-Control: no-store, private` (`400`, `403` or `405` otherwise, always empty). It never redirects and never echoes or logs what it receives.
- **The cookie name comes from your configuration** (`clickIdParam`, else `cgid`), never from the request. `days` is 1 to 400 (default 30); `Secure` is on unless you turn it off.
- **The cookie is readable by the page on purpose** (not `HttpOnly`): the web script needs to read it. It only holds the click ID.
- **Visitor context for goals:** `Goal.builder().reference("APP-55231").context(ClikgateFilter.context(clikgate, request))` adds `kept_by`, `browser_engine` and `platform` (parsed from the `User-Agent` in the SDK; the User-Agent itself is never sent). Allowed in private mode.

See the "Spring Boot" section of [the Java SDK README](https://github.com/clikgate/clikgate-sdks/blob/main/server/java/README.md#spring-boot) and `../java/examples/spring-boot`. Licence: MIT.
