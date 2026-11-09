# com.clikgate:clikgate-java

The official Clikgate server SDK for Java and Kotlin. It:

- sends goals in three lines;
- keeps the click ID;
- verifies webhooks;
- has private mode built in.

It supports Java 8+ (bytecode 52, for banks still on Java 8) and has one runtime dependency, Jackson databind. Nullability is annotated with JSpecify, so Kotlin sees real nullable types.

```xml
<dependency>
  <groupId>com.clikgate</groupId>
  <artifactId>clikgate-java</artifactId>
  <version>1.1.0</version>
</dependency>
```

Gradle: `implementation("com.clikgate:clikgate-java:1.1.0")`.

```java
Clikgate clikgate = Clikgate.fromEnv();   // reads CLIKGATE_API_KEY (cg_live_… or cg_test_…)
clikgate.goal("account_opened", Goal.builder().clickId(clickId).reference("APP-55231").value(new BigDecimal("2000000")).build());
```

Create one client and reuse it. It is thread-safe.

- **`goal()`** never throws. It queues the event, and a daemon thread sends it in batches with safe retries. A JVM shutdown hook flushes the queue (`Spring` closes the bean instead).
- **`goals().send()`** waits for the API and returns the `GoalEvent`: `getStatus()` is `GoalStatus.COUNTED`, `WAITING`, `RECEIVED` or `REFUSED` (with `getReason()`), plus `getGoalKind()` (`GoalKind.STANDARD` or `GoalKind.PAYMENT`), `getEventStatus()`, `getAttributedTo()`, …. `received` means the name isn't ticked as a goal in the dashboard yet (or the goal is archived): it is stored, not counted, and shows in "Seen from your app and website". Every status is a result, never an error, and none is retried. Goals work on every plan, up to the plan's allowance.

`goal()` is the only goal method: there is no separate payment method. The goal's kind (Standard or Payment) is set in the goal's settings in the dashboard, never in the call.

| Artifact | For |
|---|---|
| `com.clikgate:clikgate-java` | the SDK (Java 8+) |
| `com.clikgate:clikgate-spring-boot-starter` | Spring Boot 4 (Java 17+): a `Clikgate` bean from `clikgate.*`, the filter, `@ClikgateClickId`, `ClikgateContext` |
| `com.clikgate:clikgate-servlet-jakarta` | `com.clikgate.servlet.jakarta.ClikgateFilter` (Jakarta Servlet 5+) |
| `com.clikgate:clikgate-servlet-javax` | `com.clikgate.servlet.javax.ClikgateFilter` (Servlet 3.1/4, Java EE) |


### Match by hashed email or phone (ad networks)

If the business has turned on matching by hashed email or phone for an ad network destination, a goal can carry the customer's email and phone as SHA-256 hashes. `HashForAds.hash(email, phone)` normalises and hashes them on your server (pure and offline; either argument may be null): the email is trimmed and lowercased, and the phone must include its country code (`+234 803 123 4567` or `00234…`; a national number such as `0803 123 4567` is refused with `invalid_argument`). Pass the result with `.hashed(…)`, or set `hashedEmail()`, `hashedPhoneE164()` and `hashedPhoneDigits()` yourself (64 lowercase hex characters, else a local `invalid_hashed_identifier`).

```java
clikgate.goal("account_opened", Goal.builder()
    .clickId(clickId)
    .reference("APP-55231")
    .hashed(HashForAds.hash(customer.getEmail(), customer.getPhone()))
    .build());
```

In private mode, hash on your own server: Clikgate never hashes for you there. The hashes are never written to the SDK's logs or `onError` context.

## Identify your users

Two ways to tell Clikgate which of your users is using the app. Full guide: https://clikgate.com/docs/identify-users. The customer ID is your own user ID from your database, never an email, phone number or ID number. Anonymous users don't need either path.

**Path A (default): identity token.** Create the identity secret in Apps › your app › Identity secret and store it as `CLIKGATE_IDENTITY_SECRET` on your server only. `IdentityTokens.create(customerId[, appId])` (also `clikgate.createIdentityToken()`, with the builder's `identitySecret(...)` / `identitySecrets(...)`; Spring Boot: `clikgate.identity-secret`, `clikgate.identity-secrets.<appId>`) signs a token with no network call; return it in the responses the app already calls, and the app passes it to the mobile SDK's `identifyUser()`. Tokens last 30 days by default and are never force-refreshed. Throws `ClikgateServerOnlyException` in an Android app (when `android.os.Build` loads).

```java
// sign-in and "current user" responses: one extra field
response.put("clikgateIdentityToken", IdentityTokens.create(user.getId()));   // reads CLIKGATE_IDENTITY_SECRET
IdentityTokens.create(user.getId(), "app_…");                                  // several apps: CLIKGATE_IDENTITY_SECRETS
```

**Path B: installation ID, no secret or token.** The app reads `getInstallationId()` and includes it in its sign-in request; your server calls `identifyUser` with the app ID, installation ID and customer ID, after sign-in and at every signed-in app open. Clikgate accepts installations active in the last 7 days.

```java
// The app sends Clikgate.getInstallationId() with its sign-in request (null when tracking is off: skip)
if (installationId != null) {
  clikgate.identifyUser(IdentifyUserParams.builder().appId("app_…").installationId(installationId).customerId(user.getId()).build());
}
```

## People: identify a user and label them

Link a click, an app installation or your customer ID to a person, and give them a label your team sees instead of the click ID (1-80 characters; Growth and up). From your server this is always verified. Goals take the same `label`, and `isFirst` from your server is what counts a new customer. Don't put information in labels that your customers wouldn't expect you to keep.

```java
clikgate.identifyUser(IdentifyUserParams.builder().clickId(order.clickId()).customerId("user_42").label("Ada (VIP)").build());
clikgate.goal("account_opened", Goal.builder().clickId(clickId).reference("APP-55231").isFirst(true).label("Ada (VIP)").build());
```

## Keep the click ID

The pattern is: capture it on landing, save it with your own record, then send the goal later from any job.

```java
// Spring Boot: the starter registers the filter
@PostMapping("/applications")
Application create(@RequestBody Form form, @ClikgateClickId String clickId) {
  return repository.save(new Application(form, clickId));
}

// days later, when the account is approved:
clikgate.goal("account_opened", Goal.builder().clickId(app.getClickId()).reference(app.getReference()).value(2_000_000L).currency("NGN").build());
```

- **Spring, anywhere in the request thread:** `ClikgateContext.currentClickId()`.
- **Servlet without Spring:** register `new ClikgateFilter(clikgate)` and read `ClikgateFilter.clickId(request)` (the request attribute `clikgate.click_id`).
- **The filter** keeps a `?cgid=…` in the first-party `_cg_cgid` cookie, which the web script also reads.
- **By hand:** `clikgate.clickIds().fromRequest(url, request::getHeader)` and `clikgate.clickIds().persist(response::addHeader, clickId, CookieOptions.defaults())`.
- **From payment payloads** (Paystack, Flutterwave, Shopify, WooCommerce): `clikgate.clickIds().fromPaymentMetadata(json)`.

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

1. **Persist it from the query** when a visitor lands with `?cgid=…`: the filter does it (also `persist()` by hand), and adds the `_cg_kept=s` marker so goals report `kept_by: server_cookie`.
2. **The `/cg/keep` route**, for pages your server doesn't render itself (a static or cached landing page): add `data-server-endpoint="/cg/keep"` to the web script, and it posts the click ID from the page URL to that route once.

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_test_…" data-server-endpoint="/cg/keep" async></script>
```

**Servlet** (`clikgate-servlet-jakarta` or `clikgate-servlet-javax`):

```java
servletContext.addFilter("clikgate", new ClikgateFilter(clikgate, true, 90, null)).addMappingForUrlPatterns(null, false, "/*");
servletContext.addServlet("clikgate-keep", new ClikgateKeepServlet(clikgate, CookieOptions.defaults().days(90))).addMapping("/cg/keep");
```

**Spring Boot** (the starter):

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

- **Same server only.** The route must be served by the same host as the website (same scheme, host and port), because the cookie is first-party. It accepts only a same-origin `POST` (`Sec-Fetch-Site: same-origin`, else an `Origin` equal to the host), a JSON body of at most 1 KB with the same valid click ID in `click_id` and `page_click_id`, and answers `204` with `Cache-Control: no-store, private` (`400`, `403` or `405` otherwise, always empty). It never redirects and never echoes or logs what it receives.
- **The cookie name comes from your configuration** (`clickIdParam`, else `cgid`), never from the request. `days` is 1 to 400 (default 30); `Secure` is on unless you turn it off.
- **The cookie is readable by the page on purpose** (not `HttpOnly`): the web script needs to read it. It only holds the click ID.
- **Elsewhere:** `clikgate.clickIds().keepRoute(options).respond(method, request::getHeader, body)` returns the status and headers to send (read at most `KeepRoute.MAX_BODY + 1` bytes of the body).
- **Visitor context for goals:** `ClikgateFilter.context(clikgate, request)` (or `clikgate.clickIds().context(url, request::getHeader)`) returns a `ClickContext` with the click ID, `getKeptBy()` (`server_cookie`, `script_cookie`, `form` or null), `getBrowserEngine()` and `getPlatform()`. The SDK reads the `User-Agent` to work these out; the User-Agent itself is never sent. Pass it with `Goal.builder().reference("APP-55231").context(ctx)`, or set `keptBy(...)`, `browserEngine(...)`, `platform(...)` yourself. These three fields are allowed in private mode.

## Spring Boot

```properties
clikgate.api-key=${CLIKGATE_API_KEY}
clikgate.send-mode=background     # or sync
clikgate.private-mode=auto        # auto, true or false
clikgate.timeout=10s
clikgate.cookie.days=30
```

Other properties:

- `clikgate.base-url`, `clikgate.max-retries`, `clikgate.click-id-param`, `clikgate.proxy`;
- `clikgate.batch-size`, `clikgate.flush-interval`, `clikgate.max-queue-size`;
- `clikgate.cookie.persist`, `clikgate.cookie.domain`, `clikgate.filter.enabled`, `clikgate.filter.order`;
- `clikgate.keep-route.enabled` (default false), `clikgate.keep-route.path` (`/cg/keep`), `clikgate.keep-route.secure` (true): the `/cg/keep` route above;
- `clikgate.enabled=false` turns the auto-configuration off.

An `OnError` bean, if you define one, receives background failures. The full example is in `examples/spring-boot`.

## Payment goals

A **Payment goal** counts only when a trusted source confirms the payment, with the confirmed amount:

- Your **website or app** reports it with `goal()` and the payment's `provider` and `reference` (never an amount);
  the result is `WAITING` until it is confirmed.
- Your **server** confirms it **right after its own verification with the gateway**, in one of two ways:
  - send the same Payment goal with `goals().send()` and the confirmed value:

    ```java
    GoalEvent e = clikgate.goals().send("order_paid", Goal.builder()
        .reference("T123456").provider(Provider.PAYSTACK).value(new BigDecimal("7500")).currency("NGN").clickId(clickId).build());
    if (e.getStatus() == GoalStatus.WAITING) { /* counted once the website's or app's report arrives */ }
    ```

  - or pass the gateway's verified response to a helper. It reads only the reference, status, amount, currency and
    time (plus `cg_click_id` from the metadata) and sends them to `POST /v1/payments/confirmations`.

Never send data from the browser or the app this way. The SDK never calls the gateway and never takes a gateway key.
`Provider` has a constant for every gateway (`Provider.PAYSTACK`, `Provider.MTN_MOMO`, …); `Provider.fromString("…")`
or a plain string names a gateway added after your SDK release (the API checks it).

```java
// Paystack: after your own GET https://api.paystack.co/transaction/verify/{reference}
String verifyBody = paystackVerify(reference);            // the raw JSON, a Map or a Jackson JsonNode
clikgate.payments().fromPaystack(verifyBody);

// Flutterwave (GET /v3/transactions/{id}/verify), Monnify (GET /api/v2/transactions/{transactionReference})
clikgate.payments().fromFlutterwave(flutterwaveVerifyBody);
clikgate.payments().fromMonnify(monnifyStatusBody, PaymentHelperOptions.builder().goal("order_paid").build());

// Stripe: a PaymentIntent you retrieved, or the Checkout Session from a webhook you verified
clikgate.payments().fromStripe(PaymentIntent.retrieve(id).toJson());

// Any other gateway, or a refund:
clikgate.payments().confirm(PaymentConfirmParams.builder()
    .provider(Provider.PAYSTACK).reference("T_ref_001").status("refunded")
    .amount(new BigDecimal("2500")).currency("NGN").build());
```

- **Results:** each call returns the `PaymentConfirmation` (`getMatchStatus()`, `isDuplicate()`, ...). A helper
  returns `null` and sends nothing when the response isn't a transaction it recognises, and it warns
  `unrecognised_payment_response`.
- **Exact amounts:** amounts are exact decimals. Gateway minor units (Paystack, Stripe) are divided by moving the
  decimal point, and floats are read through their shortest text. `amount` and `amountMinor` take `BigDecimal`,
  `long` or a decimal string.
- **Private mode:** every confirmation field is allowed. Only `extra(...)` fields are refused.
- **Plans:** payment goals and confirmations need Starter or above; on Free the API answers `403 plan_feature_unavailable` (`PermissionException`, `getRequiredPlan()` is `starter`).
- **Required:** `provider` and `reference` on a Payment goal (`422 payment_goal_needs_confirmation`, with `missing`); the SDK can't check it, because the kind lives only in the goal's settings. `conversions().create(...)` on a Payment goal is the same confirmation and answers the goal event: check `isGoalEvent()` and read `asGoalEvent()`.
- **Pure builders:** `buildFromPaystack(...)` (and the other gateways) return the body without sending it.

## Money

- `value` is in **normal units** (₦2,000,000 is `2000000`, never kobo) and is always sent as a decimal string.
- It accepts a `BigDecimal` (sent with `toPlainString()`, keeping the scale), a `long`, or a decimal `String`.
- There are no `double` or `float` overloads.

## Webhooks

```java
WebhookEvent event = Webhooks.verify(rawBody, request.getHeader("Clikgate-Signature"), System.getenv("CLIKGATE_WEBHOOK_SECRET"));
```

- Pass the **raw** body bytes (`@RequestBody byte[]` in Spring).
- Deliveries are at-least-once: dedupe on `event.getId()`.
- Use `Webhooks.verifyAny(body, header, Arrays.asList(newSecret, oldSecret))` while you rotate your own secrets.

## Private mode

- With `PrivateMode.AUTO` (the default), the SDK reads your organisation's setting from `GET /v1/server-sdk/config` and caches it for 10 minutes.
- When private mode is on, only `goal`, `clickId`, `code`, `reference`, `value`, `currency`, `provider`, `isFirst`, `occurredAt` and `consent` are sent. Anything else (`metadata`, emails, customer IDs, …) is refused **before sending** with `PrivateModeFieldRejectedException`, which names the field, never its value.
- Payment confirmations (`payments()`) may send all their fields (`provider`, `reference`, `status`, `amount`, `amountMinor`, `currency`, `occurredAt`, `aliases`, `clickId`, `goal`, `test`); only `extra(...)` fields are refused.
- References are redacted in logs. If the setting can't be loaded, the SDK assumes private mode is on.

## Links and the rest of the API

```java
Link link = clikgate.links().create(Collections.singletonMap("destination_url", "https://example.com/spring"));
LinkUpdateResult r = clikgate.links().update(link.getId(), Collections.singletonMap("destination_url", "https://example.com/summer"));
if (!r.isApplied()) System.out.println("waiting for a second person: " + r.getChangeRequest().getId());
for (Link l : clikgate.links().list(Collections.singletonMap("limit", 100))) System.out.println(l.getShortUrl());
// Filter by your own link metadata (sent as metadata[seller_id]=sel_ada); analytics take it too.
Map<String, Object> bySeller = Collections.singletonMap("metadata", Collections.singletonMap("seller_id", "sel_ada"));
for (Link l : clikgate.links().list(bySeller)) System.out.println(l.getMetadata().get("seller_id"));
```

- A locked link throws `LinkLockedException`.
- `clikgate.api().<resource>().<operation>(…)` exposes every other API-key operation ("advanced"), generated from the OpenAPI document. It takes and returns Maps, and is sent through the same pipeline.

## Errors

Every exception is unchecked and extends `com.clikgate.exception.ClikgateException`, with `getCode()`, `getHttpStatus()`, `getRequestId()`, `getParam()`, `getType()` and `getRaw()`. The classes are:

- `ConfigurationException`, `AuthenticationException`, `PermissionException`;
- `InvalidRequestException` and `PrivateModeFieldRejectedException`;
- `NotFoundException`, `ConflictException`, `LinkLockedException`, `IdempotencyException`;
- `RateLimitException` (`getRetryAfter()`), `ServerException`;
- `ClikgateNetworkException`, `ClikgateTimeoutException`;
- `SignatureVerificationException`.

Network errors, timeouts and HTTP 429, 500, 502, 503 and 504 are retried up to `maxRetries` (3) with full-jitter backoff, honouring `Retry-After`. Each call sends a random `Idempotency-Key`, reused across its retries; the API ignores a second goal event with the same goal and reference, so a retry never double counts.

## Networking

The built-in transport is a small HTTP/1.1 client with keep-alive, one deadline per attempt, TLS hostname verification and the JVM trust store. It doesn't use `HttpURLConnection`, which can't send `PATCH` on Java 8.

- **Proxies:** `Clikgate.builder().proxy("http://user:pass@proxy.bank.local:3128")`, or the JVM's `https.proxyHost`/`https.proxyPort`/`http.nonProxyHosts`. HTTPS goes through a `CONNECT` tunnel with `Proxy-Authorization: Basic`.
- **mTLS or a corporate CA:** `SocketTransport.systemDefault().withSslSocketFactory(factory)`.
- **Any other HTTP client** (OkHttp, Apache): implement `com.clikgate.http.Transport`.

Logging goes to SLF4J when it's on the classpath (MDC key `clikgate_code`), else `java.util.logging`, both under the logger `com.clikgate`.

Licence: MIT. Security: see [SECURITY.md](SECURITY.md).
