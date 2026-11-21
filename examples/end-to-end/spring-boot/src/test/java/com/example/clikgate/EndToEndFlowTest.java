package com.example.clikgate;

import static org.assertj.core.api.Assertions.assertThat;

import com.clikgate.Clikgate;
import com.example.clikgate.webhooks.RewardStore;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Map;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** The whole flow, from sign-up to a paid referral reward, against a fake Clikgate API. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EndToEndFlowTest {
  static final String WEBHOOK_SECRET = "whsec_test_sample_only";
  static final String INSTALLATION = "app_01JAB3C4D5E6F7G8H9JKMNPQRS:6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11";
  static final FakeClikgate clikgateApi = startFake();

  @DynamicPropertySource
  static void configure(DynamicPropertyRegistry registry) {
    registry.add("clikgate.api-key", () -> "cg_test_sample_only");
    registry.add("clikgate.base-url", clikgateApi::url);
    registry.add("clikgate.identity-secret", () -> "test-identity-secret-sample-only");
    registry.add("sample.webhook-secret", () -> WEBHOOK_SECRET);
    registry.add("sample.referral-program-id", () -> "rpg_test_sample");
  }

  @AfterAll
  static void stopFake() {
    clikgateApi.close();
  }

  @Value("${local.server.port}") int port;
  @Autowired Clikgate clikgate;
  @Autowired RewardStore rewards;
  final HttpClient http = HttpClient.newHttpClient();

  @Test
  void signUpSignInMePaymentReferralAndRewards() throws Exception {
    // 1. Sign-up: the token carries the account date, and Path B identifies the installation from the header.
    var signUp = call("POST", "/auth/sign-up", "{\"email\":\"ada@example.com\",\"password\":\"correct horse\"}", null);
    assertThat(signUp.statusCode()).isEqualTo(201);
    Map<String, Object> session = json(signUp);
    String accessToken = (String) session.get("accessToken");
    Map<?, ?> user = (Map<?, ?>) session.get("user");
    String userId = (String) user.get("id");
    long createdAt = Instant.parse((String) user.get("createdAt")).getEpochSecond();
    assertIdentityTokenHasAccountDate(session.get("clikgateIdentityToken"), createdAt);

    var identify = clikgateApi.requestsTo("/v1/people/identify").get(0).body();
    assertThat(identify).containsEntry("installation_id", "6a1f0c2e-4b7d-4c1a-9e2f-0d3b5a7c9e11")
        .containsEntry("app_id", "app_01JAB3C4D5E6F7G8H9JKMNPQRS")
        .containsEntry("customer_id", userId)
        .containsKey("customer_since");

    // 2. Sign-in: wrong password refused, right password gets a fresh token.
    assertThat(call("POST", "/auth/sign-in", "{\"email\":\"ada@example.com\",\"password\":\"nope\"}", null).statusCode())
        .isEqualTo(401);
    var signIn = call("POST", "/auth/sign-in", "{\"email\":\"ada@example.com\",\"password\":\"correct horse\"}", null);
    assertIdentityTokenHasAccountDate(json(signIn).get("clikgateIdentityToken"), createdAt);

    // 3. /me needs the session, and returns a token too.
    assertThat(call("GET", "/me", null, null).statusCode()).isEqualTo(401);
    assertIdentityTokenHasAccountDate(json(call("GET", "/me", null, accessToken)).get("clikgateIdentityToken"), createdAt);

    // 4. The server goal from sign-up was queued; flushing sends it.
    assertThat(clikgate.flush(Duration.ofSeconds(5))).isTrue();
    assertThat(clikgateApi.requests).anyMatch(r -> r.path().startsWith("/v1/goals/events")
        && r.body().toString().contains("account_opened") && r.body().toString().contains(userId));

    // 5. Payment: confirmed from the (stubbed) gateway's answer, in normal units.
    var payment = call("POST", "/payments/paystack/confirm", "{\"reference\":\"T123456\"}", accessToken);
    assertThat(payment.statusCode()).isEqualTo(200);
    assertThat(clikgateApi.requestsTo("/v1/payments/confirmations").get(0).body())
        .containsEntry("provider", "paystack").containsEntry("reference", "T123456")
        .containsEntry("amount", "7500").containsEntry("currency", "NGN").containsEntry("goal", "order_paid");

    // 6. Referral code: the same code on every call.
    Map<String, Object> first = json(call("GET", "/me/referral", null, accessToken));
    Map<String, Object> second = json(call("GET", "/me/referral", null, accessToken));
    assertThat(first.get("code")).isNotNull().isEqualTo(second.get("code"));
    assertThat((String) first.get("link")).startsWith("https://");
    assertThat(clikgateApi.requestsTo("/v1/referral-programs/rpg_test_sample/referrers").get(0).body())
        .containsEntry("customer_user_id", userId);

    // Every call to the API used the server key.
    assertThat(clikgateApi.requests).allMatch(r -> "Bearer cg_test_sample_only".equals(r.authorization()));

    // 7. Webhooks: verified, deduplicated, and the reward is paid once.
    assertThat(webhook("evt_1", "referral.qualified", "ref_1", userId, WEBHOOK_SECRET)).isEqualTo(200);
    assertThat(webhook("evt_1", "referral.qualified", "ref_1", userId, WEBHOOK_SECRET)).isEqualTo(200); // redelivery
    assertThat(webhook("evt_2", "referral.qualified", "ref_1", userId, WEBHOOK_SECRET)).isEqualTo(200); // same referral
    assertThat(rewards.paidCount()).isEqualTo(1);
    assertThat(rewards.find("ref_1").orElseThrow().referrerUserId()).isEqualTo(userId);

    assertThat(webhook("evt_3", "referral.disqualified", "ref_2", userId, WEBHOOK_SECRET)).isEqualTo(200);
    assertThat(rewards.find("ref_2").orElseThrow().status()).isEqualTo(RewardStore.Status.DISQUALIFIED);
    assertThat(webhook("evt_4", "referral.qualified", "ref_3", userId, "whsec_wrong")).isEqualTo(400);
    assertThat(rewards.find("ref_3")).isEmpty();
    assertThat(rewards.paidCount()).isEqualTo(1);
  }

  private static void assertIdentityTokenHasAccountDate(Object token, long createdAtSeconds) {
    // A version 2 token ends with the account date in Unix seconds: <signature>.<issued at>.<customer since>
    String[] parts = ((String) token).split("\\.");
    assertThat(parts).hasSize(3);
    assertThat(parts[2]).isEqualTo(Long.toString(createdAtSeconds));
  }

  private int webhook(String eventId, String type, String referralId, String referrerUserId, String secret)
      throws Exception {
    String body = FakeClikgate.JSON.writeValueAsString(Map.of("id", eventId, "type", type, "data", Map.of("object",
        Map.of("id", referralId, "status", type.substring("referral.".length()),
            "referrer", Map.of("customer_user_id", referrerUserId), "referee", Map.of("customer_user_id", "user_friend")))));
    long t = Instant.now().getEpochSecond();
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
    String signature = HexFormat.of().formatHex(mac.doFinal((t + "." + body).getBytes(StandardCharsets.UTF_8)));
    HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/webhooks/clikgate"))
        .header("Content-Type", "application/json")
        .header("Clikgate-Signature", "t=" + t + ",v1=" + signature)
        .POST(HttpRequest.BodyPublishers.ofString(body)).build();
    return http.send(request, HttpResponse.BodyHandlers.ofString()).statusCode();
  }

  private HttpResponse<String> call(String method, String path, String body, String accessToken) throws Exception {
    HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
        .header("Content-Type", "application/json")
        .header("Clikgate-Installation", INSTALLATION)
        .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
    if (accessToken != null) {
      request.header("Authorization", "Bearer " + accessToken);
    }
    return http.send(request.build(), HttpResponse.BodyHandlers.ofString());
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> json(HttpResponse<String> response) {
    return FakeClikgate.JSON.readValue(response.body(), Map.class);
  }

  private static FakeClikgate startFake() {
    try {
      return new FakeClikgate();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
