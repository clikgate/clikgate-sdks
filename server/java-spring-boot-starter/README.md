# com.clikgate:clikgate-spring-boot-starter

Spring Boot 4 (Java 17+) auto-configuration for [`com.clikgate:clikgate-java`](../java/README.md):

- a `Clikgate` bean from `clikgate.*` properties (closed with the context, which flushes queued goals);
- the click-ID servlet filter;
- `@ClikgateClickId String clickId` handler parameters;
- `ClikgateContext.currentClickId()`;
- the `/cg/keep` route, when `clikgate.keep-route.enabled=true`.

```xml
<dependency>
  <groupId>com.clikgate</groupId>
  <artifactId>clikgate-spring-boot-starter</artifactId>
  <version>1.1.0</version>
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

**Path B (no secret or token):** the app sends `getInstallationId()` with its sign-in request, and your server calls `clikgate.identifyUser(...)` with `appId`, `installationId` and `customerId` after sign-in and at every signed-in app open (skip it when there's no installation ID). See the [Java SDK](../java/README.md#identify-your-users).

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

See the "Spring Boot" section of [the Java SDK README](../java/README.md#spring-boot) and `../java/examples/spring-boot`. Licence: MIT.
