package com.example.clikgate;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import tools.jackson.databind.json.JsonMapper;

/**
 * A local stand-in for the Clikgate API, so the test never calls the real one. It answers the calls this backend
 * makes with the API's response shapes, and records every request for the test to check.
 */
final class FakeClikgate implements AutoCloseable {
  record Request(String method, String path, String authorization, Map<String, Object> body) {}

  static final JsonMapper JSON = JsonMapper.builder().build();

  final List<Request> requests = new CopyOnWriteArrayList<>();
  private final Map<String, String> codesByCustomer = new ConcurrentHashMap<>();
  private final HttpServer server;

  FakeClikgate() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", this::handle);
    server.start();
  }

  String url() {
    return "http://127.0.0.1:" + server.getAddress().getPort();
  }

  List<Request> requestsTo(String path) {
    return requests.stream().filter(r -> r.path().equals(path)).toList();
  }

  @Override
  public void close() {
    server.stop(0);
  }

  private void handle(HttpExchange exchange) throws IOException {
    String path = exchange.getRequestURI().getPath();
    byte[] raw = exchange.getRequestBody().readAllBytes();
    Map<String, Object> body = raw.length == 0 ? Map.of() : JSON.readValue(raw, Map.class);
    requests.add(new Request(exchange.getRequestMethod(), path,
        exchange.getRequestHeaders().getFirst("Authorization"), body));
    if (path.equals("/v1/server-sdk/config")) {
      reply(exchange, 200, Map.of("mode", "test", "private_mode", false, "goals", List.of(
          Map.of("key", "account_opened", "value_mode", "optional"), Map.of("key", "order_paid", "value_mode", "optional"))));
    } else if (path.equals("/v1/people/identify")) {
      reply(exchange, 200, Map.of("object", "person_identified", "person_id", "per_fake"));
    } else if (path.equals("/v1/goals/events")) {
      reply(exchange, 201, Map.of("object", "goal_event", "id", "cnv_fake", "status", "counted"));
    } else if (path.equals("/v1/goals/events/batch")) {
      reply(exchange, 200, goalBatch(body));
    } else if (path.equals("/v1/payments/confirmations")) {
      reply(exchange, 201, paymentConfirmation(body));
    } else if (path.matches("/v1/referral-programs/[^/]+/referrers")) {
      referrer(exchange, String.valueOf(body.get("customer_user_id")));
    } else {
      reply(exchange, 404, Map.of("error", Map.of("code", "not_found", "message", "Not in the fake.")));
    }
  }

  /** Same customer, same code: 201 the first time, 200 after that, like the API. */
  private void referrer(HttpExchange exchange, String customerUserId) throws IOException {
    boolean created = !codesByCustomer.containsKey(customerUserId);
    String code = codesByCustomer.computeIfAbsent(customerUserId, id -> "TANGO-" + (codesByCustomer.size() + 1));
    reply(exchange, created ? 201 : 200, Map.of("object", "referrer", "id", "rfr_" + code, "code", code,
        "customer_user_id", customerUserId, "short_url", "https://go.example.com/r/" + code));
  }

  private static Map<String, Object> goalBatch(Map<String, Object> body) {
    List<Object> results = new ArrayList<>();
    Object events = body.get("events");
    int count = events instanceof List<?> list ? list.size() : 0;
    for (int i = 0; i < count; i++) {
      results.add(Map.of("index", i, "ok", true, "status", 201,
          "goal_event", Map.of("object", "goal_event", "id", "cnv_fake_" + i, "status", "counted")));
    }
    return Map.of("object", "list", "data", results);
  }

  private static Map<String, Object> paymentConfirmation(Map<String, Object> body) {
    Map<String, Object> confirmation = new HashMap<>(body);
    confirmation.put("object", "payment_confirmation");
    confirmation.put("id", "pcf_fake");
    confirmation.put("match_status", "matched");
    confirmation.put("duplicate", false);
    return confirmation;
  }

  private static void reply(HttpExchange exchange, int status, Object json) throws IOException {
    byte[] bytes = JSON.writeValueAsString(json).getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "application/json");
    exchange.sendResponseHeaders(status, bytes.length);
    exchange.getResponseBody().write(bytes);
    exchange.close();
  }
}
