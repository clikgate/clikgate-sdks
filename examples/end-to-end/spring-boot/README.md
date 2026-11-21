# End-to-end sample: Spring Boot 4

The backend of a mobile app with Clikgate added, using `com.clikgate:clikgate-spring-boot-starter` (Spring Boot 4,
Java 17+). The routes, and what each one shows, are in [the overview](../README.md).

## Run it

You need Java 17+ and Maven.

```bash
# 1. Build the SDK from this repository (see "SDK version" below)
(cd ../../../server/java && mvn install -DskipTests)

# 2. Configure: copy the placeholders and fill in your test keys
cp .env.example .env
set -a; . ./.env; set +a

# 3. Start the backend on http://localhost:8080
mvn spring-boot:run
```

Run the test (it starts a fake Clikgate API, so it never calls the real one):

```bash
mvn verify
```

## Where things are

| File | What it shows |
| --- | --- |
| `auth/AuthController.java` | Sign-up, sign-in and `/me` return `clikgateIdentityToken`; sign-up sends a server goal |
| `identity/ClikgateIdentity.java` | Path A (identity token with the account date) and Path B (`@ClikgateInstallation` and `identifyUser`) |
| `payments/PaymentController.java` | `payments().fromPaystack(...)` after the backend's own check (the gateway call is stubbed in `PaystackGateway.java`) |
| `webhooks/WebhookController.java` | Raw-body verification and the event-ID store |
| `webhooks/ReferralEvents.java` | `EventType` and `event.asReferral()`: `referral.qualified` pays once, `referral.disqualified` pays nothing (`RewardStore.java`) |
| `referrals/ReferralCodes.java` | `GET /me/referral`: `referrals().getOrCreateReferrer(...)` gets or creates the user's referrer code |
| `src/test/.../EndToEndFlowTest.java` | The whole flow against `FakeClikgate.java` |

Users, sessions, processed events and rewards are kept in memory. Each store's comment says which table replaces it in
your app.

## Spring Security

The sample has no Spring Security, so it stays short. With it, exclude the webhook route from CSRF and let it through
without sign-in; the signature check protects it:

```java
http.csrf(csrf -> csrf.ignoringRequestMatchers("/webhooks/clikgate"))
    .authorizeHttpRequests(auth -> auth.requestMatchers("/webhooks/clikgate").permitAll().anyRequest().authenticated());
```

## SDK version

The sample uses version `2.1.0` of the starter, built from `server/java` in this repository by step 1, so it works
before that version is published. Once it is on Maven Central, skip step 1. The referral code uses
`clikgate.referrals().getOrCreateReferrer(programId, userId)`, and the webhook handler checks the type against
`EventType` first and then reads the referral with `event.asReferral()` (it throws for an event of another family).
