package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.ConflictException;
import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.PrivateModeFieldRejectedException;
import com.clikgate.http.RequestOptions;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import com.clikgate.internal.Json;
import com.clikgate.model.KnownCustomersImportResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;

/** Identity token version 2, the canonical customer ID, customerSince on identifyUser, known customers. */
class ExistingUsersTest {
  private static final String KEY = "cg_test_unit000000000000";

  private static JsonNode load(String file) {
    try {
      return new ObjectMapper().readTree(new File("../../conformance/vectors/" + file));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  /** Answers from a script, then {@code {}}. */
  static final class Script implements Transport {
    final List<TransportRequest> requests = new CopyOnWriteArrayList<>();
    final List<String> answers = new CopyOnWriteArrayList<>();

    @Override
    public TransportResponse send(TransportRequest request) {
      requests.add(request);
      String body = answers.isEmpty() ? "{}" : answers.remove(0);
      return new TransportResponse(200, Collections.singletonMap("content-type", "application/json"), body.getBytes(StandardCharsets.UTF_8));
    }

    List<Object> bodies() throws Exception {
      List<Object> out = new ArrayList<>();
      for (TransportRequest r : requests) {
        if (r.getBody() != null) out.add(Json.parse(r.getBody()));
      }
      return out;
    }
  }

  private static Map<String, Object> row(String id, String since) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("customer_id", id);
    if (since != null) m.put("customer_since", since);
    return m;
  }

  private static Clikgate client(Script s, PrivateMode pm) {
    return Clikgate.builder().apiKey(KEY).transport(s).privateMode(pm).shutdownHooks(false).build();
  }

  @Test
  void version2TokensMatchTheSharedVectors() {
    JsonNode doc = load("identity-token-vectors.json");
    int n = 0;
    for (JsonNode v : doc.get("v2")) {
      assertEquals(
          v.get("token").asText(),
          IdentityTokens.create(v.get("customer_id").asText(), v.get("secret").asText(), v.get("issued_at").asLong(), v.get("customer_since").asLong()),
          v.get("name").asText());
      n++;
    }
    assertTrue(n >= 10);
    for (JsonNode bad : doc.get("v2_invalid_customer_since")) {
      InvalidRequestException e = assertThrows(
          InvalidRequestException.class, () -> IdentityTokens.create("user_42", "cgis_unit", bad.get("issued_at").asLong(), bad.get("customer_since").asLong()));
      assertEquals("customer_since", e.getParam());
    }
    for (JsonNode f : doc.get("forgeries")) assertNotEquals(f.get("real_token").asText(), f.get("forged_token").asText());
  }

  @Test
  void clientMethodWithAnInstant() {
    Clikgate c = Clikgate.builder().apiKey(KEY).transport(new Script()).shutdownHooks(false).identitySecret("cgis_VectorOnly0000000000000000000000000000").build();
    String token = c.createIdentityToken("user_42", null, Instant.ofEpochSecond(1709370000L));
    assertTrue(token.endsWith(".1709370000"));
    assertEquals(3, token.split("\\.").length);
  }

  @Test
  void canonicalCustomerIdsAndWarnings() {
    for (JsonNode v : load("customer-id-vectors.json").get("vectors")) {
      String name = v.get("name").asText();
      assertEquals(v.get("canonical").asText(), CustomerIds.canonical(v.get("input").asText()), name);
      String expected = v.get("warning").isNull() ? null : v.get("warning").asText();
      assertEquals(expected, CustomerIds.warning(v.get("input").asText(), v.get("allow_11_digit_ids").asBoolean()), name);
    }
  }

  @Test
  @SuppressWarnings("unchecked")
  void identifyUserSendsCustomerSince() throws Exception {
    Script s = new Script();
    s.answers.add("{\"object\":\"person_identified\",\"person_id\":\"per_1\",\"label_ignored\":null,\"customer_since_ignored\":\"unverified\",\"customer_id_warning\":null}");
    Clikgate c = client(s, PrivateMode.OFF);
    assertEquals("unverified", c.identifyUser(IdentifyUserParams.builder().customerId("u_1").customerSince(LocalDate.of(2024, 3, 2)).build()).getCustomerSinceIgnored());
    c.identifyUser(IdentifyUserParams.builder().customerId("u_1").customerSince(Instant.parse("2024-03-02T09:00:00Z")).customerSinceReplace(true).build());
    List<Object> bodies = s.bodies();
    assertEquals("2024-03-02", ((Map<String, Object>) bodies.get(0)).get("customer_since"));
    assertFalse(((Map<String, Object>) bodies.get(0)).containsKey("customer_since_replace"));
    assertEquals("2024-03-02T09:00:00Z", ((Map<String, Object>) bodies.get(1)).get("customer_since"));
    assertEquals(Boolean.TRUE, ((Map<String, Object>) bodies.get(1)).get("customer_since_replace"));
    InvalidRequestException e = assertThrows(InvalidRequestException.class,
        () -> c.identifyUser(IdentifyUserParams.builder().appId("app_1").installationId("i").customerSince(LocalDate.of(2024, 3, 2)).build()));
    assertEquals("customer_since", e.getParam());
    assertEquals(2, s.requests.size());
  }

  @Test
  void privateModeRefusesCustomerSinceAndKnownCustomers() {
    Script s = new Script();
    Clikgate c = client(s, PrivateMode.ON);
    assertThrows(PrivateModeFieldRejectedException.class,
        () -> c.identifyUser(IdentifyUserParams.builder().appId("app_1").installationId("i").customerId("u_1").customerSince(LocalDate.of(2024, 3, 2)).build()));
    ConflictException e = assertThrows(ConflictException.class, () -> c.knownCustomers().importCustomers(Collections.singletonList(KnownCustomer.of("u_1"))));
    assertEquals("private_mode_conflict", e.getCode());
    assertNull(e.getHttpStatus());
    assertThrows(ConflictException.class, () -> c.knownCustomers().remove("u_1"));
    assertTrue(s.requests.isEmpty());
  }

  @Test
  @SuppressWarnings("unchecked")
  void importBatchesBy10000AndSumsCounts() throws Exception {
    Script s = new Script();
    s.answers.add("{\"accepted\":9990,\"refused\":10,\"refused_by_reason\":{\"looks_like_phone\":10}}");
    s.answers.add("{\"accepted\":9998,\"refused\":2,\"refused_by_reason\":{\"looks_like_phone\":1,\"bad_date\":1}}");
    s.answers.add("{\"accepted\":5,\"refused\":0,\"refused_by_reason\":{}}");
    Clikgate c = client(s, PrivateMode.OFF);
    List<KnownCustomer> rows = new ArrayList<>();
    rows.add(KnownCustomer.of("u_0", Instant.parse("2024-03-02T23:30:00Z")));
    rows.add(KnownCustomer.of("u_1", LocalDate.of(2024, 3, 2)));
    for (int i = 2; i < 20005; i++) rows.add(KnownCustomer.of("u_" + i));
    KnownCustomersImportResult r = c.knownCustomers().importCustomers(rows, RequestOptions.builder().idempotencyKey("imp-1").build());
    assertEquals(19993L, r.getAccepted());
    assertEquals(12L, r.getRefused());
    assertEquals(Long.valueOf(11L), r.getRefusedByReason().get("looks_like_phone"));
    assertEquals(Long.valueOf(1L), r.getRefusedByReason().get("bad_date"));
    assertEquals(3, s.requests.size());
    List<Object> first = (List<Object>) ((Map<String, Object>) s.bodies().get(0)).get("customers");
    assertEquals(10000, first.size());
    assertEquals(row("u_0", "2024-03-02"), first.get(0));
    assertEquals(row("u_1", "2024-03-02"), first.get(1));
    assertEquals(row("u_2", null), first.get(2));
    List<String> keys = new ArrayList<>();
    for (TransportRequest req : s.requests) {
      assertTrue(req.getUrl().endsWith("/v1/known-customers/import"));
      keys.add(req.getHeaders().entrySet().stream().filter(h -> h.getKey().equalsIgnoreCase("idempotency-key")).findFirst().map(Map.Entry::getValue).orElse(null));
    }
    assertEquals(Arrays.asList("imp-1-0", "imp-1-1", "imp-1-2"), keys);
    assertEquals(0L, c.knownCustomers().importCustomers(Collections.<KnownCustomer>emptyList()).getAccepted());
  }

  @Test
  @SuppressWarnings("unchecked")
  void removeSendsTheIdInTheBody() throws Exception {
    Script s = new Script();
    s.answers.add("{\"removed\":true}");
    Clikgate c = client(s, PrivateMode.OFF);
    assertTrue(c.knownCustomers().remove("u_10482"));
    assertTrue(s.requests.get(0).getUrl().endsWith("/v1/known-customers/remove"));
    assertFalse(s.requests.get(0).getUrl().contains("u_10482"));
    assertEquals("u_10482", ((Map<String, Object>) s.bodies().get(0)).get("customer_id"));
  }
}
