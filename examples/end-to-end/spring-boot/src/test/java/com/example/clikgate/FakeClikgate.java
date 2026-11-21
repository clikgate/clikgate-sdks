package com.example.clikgate;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
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
  private final Map<String, Map<String, Object>> referrersByCustomer = new ConcurrentHashMap<>();
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
      referrer(exchange, path.split("/")[3], String.valueOf(body.get("customer_user_id")));
    } else {
      reply(exchange, 404, Map.of("error", Map.of("code", "not_found", "message", "Not in the fake.")));
    }
  }

  /** Same customer, same referrer and code: 201 the first time, 200 after that, like the API. */
  private synchronized void referrer(HttpExchange exchange, String programId, String customerUserId) throws IOException {
    boolean created = !referrersByCustomer.containsKey(customerUserId);
    if (created) {
      referrersByCustomer.put(customerUserId, referrerObject(referrersByCustomer.size() + 1, programId, customerUserId));
    }
    reply(exchange, created ? 201 : 200, referrersByCustomer.get(customerUserId));
  }

  /** A referrer as the API returns it ({@code POST /v1/referral-programs/{id}/referrers}). */
  static Map<String, Object> referrerObject(int n, String programId, String customerUserId) {
    String code = "TANGO" + n;
    Map<String, Object> stats = new LinkedHashMap<>();
    for (String key : List.of("clicks", "installs", "signups", "in_progress", "qualified", "disqualified", "rejected")) {
      stats.put(key, 0);
    }
    stats.put("referee_uninstall_rate_7d", null);
    Map<String, Object> referrer = new LinkedHashMap<>();
    referrer.put("id", "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4R" + n);
    referrer.put("object", "referrer");
    referrer.put("program_id", programId);
    referrer.put("customer_user_id", customerUserId);
    referrer.put("display_name", null);
    referrer.put("code", code);
    referrer.put("external_code", null);
    referrer.put("link_id", "lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA");
    referrer.put("url", "https://go.example.com/r/" + code);
    referrer.put("short_url", "https://go.example.com/" + code.toLowerCase());
    referrer.put("status", "active");
    referrer.put("blocked_reason", null);
    referrer.put("blocked_at", null);
    referrer.put("stats", stats);
    referrer.put("attributes", Map.of());
    referrer.put("leaderboard_opt_out", false);
    referrer.put("quality_score", null);
    referrer.put("quality_band", null);
    referrer.put("last_activity_at", null);
    referrer.put("created_at", "2026-11-02T09:30:00Z");
    referrer.put("updated_at", "2026-11-02T09:30:00Z");
    referrer.put("livemode", false);
    return referrer;
  }

  /**
   * A {@code referral.qualified} or {@code referral.disqualified} webhook event as Clikgate sends it: the envelope, and
   * the referral in {@code data.object}.
   */
  static Map<String, Object> referralEvent(String eventId, String type, String referralId, String programId,
      String referrerUserId) {
    boolean qualified = type.equals("referral.qualified");
    List<Map<String, Object>> steps = new ArrayList<>();
    steps.add(Map.of("index", 0, "identify", true, "completed_at", "2026-11-02T10:00:00Z",
        "source_id", "identify:user_friend"));
    if (qualified) {
      steps.add(Map.of("index", 1, "goal", "order_paid", "completed_at", "2026-11-03T09:59:00Z",
          "source_id", "goal:cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE"));
    }
    Map<String, Object> referral = new LinkedHashMap<>();
    referral.put("id", referralId);
    referral.put("object", "referral");
    referral.put("program_id", programId);
    referral.put("referrer_id", "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR");
    referral.put("status", qualified ? "qualified" : "disqualified");
    referral.put("source", "link");
    referral.put("match_type", "deterministic");
    referral.put("current_step", steps.size());
    referral.put("steps_completed", steps);
    referral.put("step_deadline_at", null);
    referral.put("hold_until", null);
    referral.put("qualified_at", qualified ? "2026-11-03T10:00:00Z" : null);
    referral.put("disqualified_at", qualified ? null : "2026-11-03T10:00:00Z");
    referral.put("rejected_at", null);
    referral.put("reason", qualified ? null : "step_timeout");
    referral.put("reason_detail", null);
    referral.put("reason_message", null);
    referral.put("fraud_flags", List.of());
    referral.put("referee_uninstalled_after_qualification", false);
    referral.put("program", Map.of("id", programId, "name", "Invite friends"));
    referral.put("referrer", Map.of("id", "rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR", "customer_user_id", referrerUserId,
        "code", "TANGO1"));
    referral.put("referee", Map.of("install_id", "ins_01JCK8Z9V7Q4M2N6P8R0S2T4IN",
        "installation_id", "6a1f0c2e-0000-4000-8000-000000000002", "customer_user_id", "user_friend"));
    referral.put("link", Map.of("id", "lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA"));
    referral.put("click_id", "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6");
    if (qualified) {
      referral.put("reward_snapshot", Map.of("referrer", Map.of("amount_minor", 100000, "currency", "NGN"),
          "note", "Paid by the app"));
    }
    referral.put("created_at", "2026-11-02T09:45:00Z");
    referral.put("updated_at", "2026-11-03T10:00:00Z");
    referral.put("livemode", false);

    Map<String, Object> data = new LinkedHashMap<>();
    data.put("previous_attributes", null);
    data.put("object", referral);
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("id", eventId);
    event.put("object", "event");
    event.put("type", type);
    event.put("api_version", "2026-10-01");
    event.put("created_at", "2026-11-03T10:00:00Z");
    event.put("organization_id", "org_01JCK8Z9V7Q4M2N6P8R0S2T4OR");
    event.put("livemode", false);
    event.put("data", data);
    return event;
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
