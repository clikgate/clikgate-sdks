package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.ConfigurationException;
import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.PrivateModeFieldRejectedException;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import com.clikgate.internal.Json;
import com.clikgate.internal.UserAgent;
import com.clikgate.model.GoalEvent;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ClientTest {
  private static final String KEY = "cg_test_unit000000000000";
  private static final Pattern UA =
      Pattern.compile("^clikgate-(node|python|php|java|dotnet)/(\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?) \\(([a-z]+) ([0-9][0-9A-Za-z.+-]{0,39}); ([^ ]+) ([^)]+)\\)( .*)?$");

  /** A capturing transport: records every request that reaches the HTTP layer. */
  static final class Recorder implements Transport {
    final List<TransportRequest> requests = new CopyOnWriteArrayList<>();
    volatile int status = 201;
    volatile String body = "{\"object\":\"goal_event\",\"id\":\"gev_1\",\"counted\":true}";

    @Override
    public TransportResponse send(TransportRequest request) {
      requests.add(request);
      return new TransportResponse(status, Collections.singletonMap("content-type", "application/json"), body.getBytes(StandardCharsets.UTF_8));
    }

    List<Object> bodies() throws Exception {
      List<Object> out = new ArrayList<>();
      for (TransportRequest r : requests) {
        if (r.getBody() != null) {
          out.add(Json.parse(r.getBody()));
        }
      }
      return out;
    }
  }

  private static Clikgate client(Recorder r, PrivateMode pm, SendMode mode, List<String> errors) {
    return Clikgate.builder().apiKey(KEY).transport(r).privateMode(pm).sendMode(mode).shutdownHooks(false).onError((e, ctx) -> errors.add(e.getCode() + " " + ctx.getEvents())).build();
  }

  @Test
  void money() {
    assertEquals("1500.50", Money.formatValue(new BigDecimal("1500.50")));
    assertEquals("1000", Money.formatValue(new BigDecimal("1E+3")));
    assertEquals("9007199254740993", Money.formatValue(9007199254740993L));
    assertThrows(InvalidRequestException.class, () -> Money.formatValue(new BigDecimal("-1")));
    assertThrows(InvalidRequestException.class, () -> Money.formatValue("1e3"));
  }

  @Test
  @SuppressWarnings("unchecked")
  void goalEventReadsValueAndValueMinor() throws Exception {
    GoalEvent ev = new GoalEvent((Map<String, Object>) Json.parse(
        "{\"object\":\"goal_event\",\"value\":\"1500.5\",\"value_minor\":150050,\"currency\":\"NGN\",\"reversed_value\":null,\"reversed_value_minor\":null}"));
    assertEquals("1500.5", ev.getValue());
    assertEquals(new BigDecimal("1500.5"), ev.getValueDecimal());
    assertEquals(Long.valueOf(150050L), ev.getValueMinor());
    assertEquals(null, ev.getReversedValue());
    assertEquals(null, ev.getReversedValueMinor());
    assertEquals(null, new GoalEvent(Collections.emptyMap()).getValueMinor());
  }

  @Test
  void userAgent() {
    assertEquals("1.8.0-402", UserAgent.sanitise("1.8.0_402"));
    String ua = UserAgent.build("Windows Server 2019", "amd64", "1.8.0_402");
    assertEquals("clikgate-java/" + Version.VERSION + " (java 1.8.0-402; windows x64)", ua);
    assertTrue(UA.matcher(ua).matches());
    assertTrue(UA.matcher(UserAgent.current()).matches(), UserAgent.current());
    assertTrue(UA.matcher(UserAgent.build("Mac OS X", "aarch64", "27.0.1")).matches());
  }

  @Test
  void configuration() {
    ConfigurationException e = assertThrows(ConfigurationException.class, () -> Clikgate.builder().apiKey("cg_sdk_secretvalue").build());
    assertEquals("invalid_api_key", e.getCode());
    assertFalse(e.getMessage().contains("secretvalue"));
    assertEquals("invalid_option", assertThrows(ConfigurationException.class, () -> Clikgate.builder().apiKey(KEY).baseUrl("http://example.com").build()).getCode());
    assertEquals("invalid_option", assertThrows(ConfigurationException.class, () -> Clikgate.builder().apiKey(KEY).proxy("socks5://x:1").build()).getCode());
    try (Clikgate c = Clikgate.builder().apiKey("cg_live_x").baseUrl("http://[::1]:8080/").shutdownHooks(false).build()) {
      assertEquals("live", c.mode());
    }
  }

  @Test
  void guardNeverReachesTheTransport() throws Exception {
    Recorder r = new Recorder();
    List<String> errors = new CopyOnWriteArrayList<>();
    Clikgate c = client(r, PrivateMode.ON, SendMode.BACKGROUND, errors);
    PrivateModeFieldRejectedException e =
        assertThrows(PrivateModeFieldRejectedException.class, () -> c.goals().send("account_opened", Goal.builder().reference("APP-1").metadata(Collections.singletonMap("email", "secret@example.com")).build()));
    assertEquals("metadata", e.getField());
    assertFalse(e.getMessage().contains("secret@example.com"));
    r.body = "{\"object\":\"list\",\"data\":[]}";
    r.status = 200;
    c.goal("account_opened", Goal.builder().reference("APP-SECRET").metadata(Collections.singletonMap("ads", true)).build());
    c.goal("account_opened", Goal.of("APP-OK"));
    assertTrue(c.flush(Duration.ofSeconds(5)));
    assertEquals(1, r.requests.size());
    assertEquals(Collections.singletonList(Collections.singletonMap("events", Collections.singletonList(Json.parse("{\"goal\":\"account_opened\",\"reference\":\"APP-OK\"}")))), r.bodies());
    assertEquals(1, errors.size());
    assertTrue(errors.get(0).contains("[redacted]"), errors.get(0));
    c.close();
  }

  @Test
  void goalNeverThrowsAndSyncUsesARandomKey() throws Exception {
    Recorder r = new Recorder();
    List<String> errors = new CopyOnWriteArrayList<>();
    Clikgate c = client(r, PrivateMode.OFF, SendMode.SYNC, errors);
    c.goal("Bad-Key", Goal.of("R-1"));
    c.goal("order_paid", Goal.builder().reference("R-1").rawValue(1.5d).build());
    c.goal("account_opened", Goal.builder().reference("APP-55231").value(new BigDecimal("2000000")).build());
    assertTrue(c.flush(Duration.ofSeconds(5)));
    assertEquals(2, errors.size());
    assertTrue(errors.get(0).startsWith("invalid_goal_key"));
    assertTrue(errors.get(1).startsWith("invalid_value"));
    TransportRequest req = r.requests.get(0);
    String key = req.getHeaders().get("Idempotency-Key");
    assertEquals(4, java.util.UUID.fromString(key).version());
    assertNotEquals("7b8f11b2797939c911ba15ff4dc0be4ba912c0f05039cadac879211e1b4e9958", key);
    assertTrue(UA.matcher(req.getHeaders().get("User-Agent")).matches());
    assertEquals(Json.parse("{\"goal\":\"account_opened\",\"reference\":\"APP-55231\",\"value\":\"2000000\"}"), r.bodies().get(0));
    c.close();
  }

  @Test
  void backgroundBatchesFromManyThreads() throws Exception {
    Recorder r = new Recorder();
    r.status = 200;
    r.body = "{\"object\":\"list\",\"data\":[]}";
    Clikgate c = Clikgate.builder().apiKey(KEY).transport(r).privateMode(PrivateMode.OFF).batchSize(50).shutdownHooks(false).build();
    List<Thread> threads = new ArrayList<>();
    for (int t = 0; t < 8; t++) {
      final int n = t;
      Thread th = new Thread(() -> {
        for (int i = 0; i < 100; i++) {
          c.goal("order_paid", Goal.of("T" + n + "-" + i));
        }
      });
      threads.add(th);
      th.start();
    }
    for (Thread th : threads) {
      th.join();
    }
    assertTrue(c.flush(Duration.ofSeconds(10)));
    int total = 0;
    for (Object b : r.bodies()) {
      total += ((List<?>) ((Map<?, ?>) b).get("events")).size();
    }
    assertEquals(800, total);
    c.close();
  }

  @Test
  void apiLayerUsesThePipeline() {
    Recorder r = new Recorder();
    r.status = 200;
    r.body = "{\"object\":\"link\",\"id\":\"lnk_1\"}";
    Clikgate c = client(r, PrivateMode.OFF, SendMode.SYNC, new ArrayList<>());
    Object link = c.api().links().fetchLink("lnk_a/b");
    assertEquals("lnk_1", ((Map<?, ?>) link).get("id"));
    assertTrue(r.requests.get(0).getUrl().endsWith("/v1/links/lnk_a%2Fb"));
    assertFalse(r.requests.get(0).getHeaders().containsKey("Idempotency-Key"));
    c.close();
  }

  @Test
  @SuppressWarnings("unchecked")
  void metadataFilterLinkMetadataAndEndGoalValue() throws Exception {
    // Change 10: a metadata map is sent as metadata[<key>]=<value>; Link exposes its metadata.
    Recorder r = new Recorder();
    r.status = 200;
    r.body = "{\"object\":\"list\",\"data\":[{\"group\":\"sel_ada\",\"end_goal_value\":{\"NGN\":\"18500.00\"},\"end_goal_value_minor\":{\"NGN\":1850000}}],\"has_more\":false,\"next_cursor\":null}";
    Clikgate c = client(r, PrivateMode.OFF, SendMode.SYNC, new ArrayList<>());
    Map<String, Object> query = new java.util.LinkedHashMap<>();
    query.put("group_by", "metadata.product_id");
    query.put("metadata", Collections.singletonMap("seller_id", "sel ada"));
    Map<String, Object> page = (Map<String, Object>) c.api().analytics().analyticsSummary(query);
    assertTrue(r.requests.get(0).getUrl().endsWith("/v1/analytics/summary?group_by=metadata.product_id&metadata%5Bseller_id%5D=sel%20ada"), r.requests.get(0).getUrl());
    // end_goal_value stays a decimal string per currency, next to end_goal_value_minor (X.E10).
    Map<String, Object> row = (Map<String, Object>) ((List<Object>) page.get("data")).get(0);
    assertEquals("18500.00", ((Map<String, Object>) row.get("end_goal_value")).get("NGN"));

    r.body = "{\"object\":\"link\",\"id\":\"lnk_1\",\"external_reference\":\"sel_ada:prd_1\",\"metadata\":{\"seller_id\":\"sel_ada\"}}";
    com.clikgate.model.Link link = c.links().get("lnk_1");
    assertEquals("sel_ada", link.getMetadata().get("seller_id"));
    assertEquals("sel_ada:prd_1", link.getExternalReference());
    r.body = "{\"object\":\"link\",\"id\":\"lnk_2\"}";
    assertTrue(c.links().get("lnk_2").getMetadata().isEmpty());
    c.close();
  }

  @Test
  void webhooksWithoutAClient() {
    String body = "{\"id\":\"evt_1\",\"object\":\"event\",\"type\":\"goal.completed\",\"data\":{\"object\":{}}}";
    long t = 1_793_016_000L;
    String sig = hmacHex("whsec_x", t + "." + body);
    assertEquals("evt_1", Webhooks.verify(body.getBytes(StandardCharsets.UTF_8), "t=" + t + ",v1=" + sig, "whsec_x", 300, t).getId());
  }

  private static String hmacHex(String key, String msg) {
    try {
      javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
      mac.init(new javax.crypto.spec.SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      StringBuilder sb = new StringBuilder();
      for (byte b : mac.doFinal(msg.getBytes(StandardCharsets.UTF_8))) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
