package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.ClikgateException;
import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.PermissionException;
import com.clikgate.exception.PrivateModeFieldRejectedException;
import com.clikgate.exception.RateLimitException;
import com.clikgate.exception.ServerException;
import com.clikgate.http.Clock;
import com.clikgate.http.RequestOptions;
import com.clikgate.internal.Core;
import com.clikgate.internal.Json;
import com.clikgate.model.LinkUpdateResult;
import com.clikgate.model.Provider;
import com.clikgate.model.QrCode;
import com.clikgate.model.WireObject;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

/**
 * The Java conformance runner (server/conformance/README.md, "Runner protocol"): starts the shared mock server,
 * runs every case for language "java" and lets the mock judge each one.
 *
 * <pre>mvn -pl clikgate-java test -Dconformance=true -Dtest=ConformanceTest [-Dconformance.filter=retries]</pre>
 */
@EnabledIfSystemProperty(named = "clikgate.conformance", matches = "true")
class ConformanceTest {
  private String base = "";

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object o) {
    return o instanceof Map ? (Map<String, Object>) o : new LinkedHashMap<String, Object>();
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object o) {
    return o instanceof List ? (List<Object>) o : new ArrayList<Object>();
  }

  private Object control(String path, Object body) throws Exception {
    HttpURLConnection c = (HttpURLConnection) new URL(base + "/__control" + path).openConnection(Proxy.NO_PROXY);
    c.setConnectTimeout(60_000);
    c.setReadTimeout(60_000);
    if (body != null) {
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setRequestProperty("content-type", "application/json");
      try (OutputStream out = c.getOutputStream()) {
        out.write(Json.write(body));
      }
    }
    int status = c.getResponseCode();
    InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    byte[] b = new byte[8192];
    for (int n; (n = in.read(b)) > 0; ) {
      buf.write(b, 0, n);
    }
    if (status != 200) {
      throw new IllegalStateException("control " + path + ": HTTP " + status + " " + buf);
    }
    return Json.parse(buf.toByteArray());
  }

  private static Object decode(Object v) {
    if (v instanceof List) {
      List<Object> out = new ArrayList<>();
      for (Object o : (List<?>) v) {
        out.add(decode(o));
      }
      return out;
    }
    if (v instanceof Map) {
      Map<?, ?> m = (Map<?, ?>) v;
      if (m.size() == 1) {
        Map.Entry<?, ?> e = m.entrySet().iterator().next();
        String k = String.valueOf(e.getKey());
        String x = String.valueOf(e.getValue());
        switch (k) {
          case "$decimal":
            return new BigDecimal(x);
          case "$float":
            return Double.valueOf(x);
          case "$bigint":
            return Long.valueOf(x);
          case "$datetime":
            return Instant.parse(x);
          case "$bytes_base64":
            return Base64.getDecoder().decode(x);
          default:
            break;
        }
      }
      Map<String, Object> out = new LinkedHashMap<>();
      for (Map.Entry<?, ?> e : m.entrySet()) {
        out.put(String.valueOf(e.getKey()), decode(e.getValue()));
      }
      return out;
    }
    return v;
  }

  static Map<String, Object> serialiseError(Throwable e) {
    Map<String, Object> m = new LinkedHashMap<>();
    if (e instanceof ClikgateException) {
      ClikgateException c = (ClikgateException) e;
      m.put("class", Core.canonical(c));
      m.put("code", c.getCode());
      m.put("http_status", c.getHttpStatus());
      m.put("param", c.getParam());
      m.put("request_id", c.getRequestId());
      m.put("type", c.getType());
      m.put("retry_after", c instanceof RateLimitException ? ((RateLimitException) c).getRetryAfter() : c instanceof ServerException ? ((ServerException) c).getRetryAfter() : null);
      m.put("field", c instanceof PrivateModeFieldRejectedException ? ((PrivateModeFieldRejectedException) c).getField() : null);
      m.put("index", c instanceof InvalidRequestException ? ((InvalidRequestException) c).getIndex() : null);
      m.put("allowed", c instanceof InvalidRequestException ? ((InvalidRequestException) c).getAllowed() : null);
      m.put("doc_url", c instanceof InvalidRequestException ? ((InvalidRequestException) c).getDocUrl() : null);
      m.put("required_plan", c instanceof PermissionException ? ((PermissionException) c).getRequiredPlan() : null);
      m.put("limit", c instanceof PermissionException ? ((PermissionException) c).getLimit() : null);
      m.put("message", c.getMessage());
    } else {
      m.put("class", e.getClass().getSimpleName());
      m.put("code", null);
      m.put("message", String.valueOf(e.getMessage()));
    }
    return m;
  }

  static Goal goal(Map<String, Object> a) {
    Goal.Builder b = Goal.builder();
    b.reference((String) a.get("reference"));
    b.clickId((String) a.get("click_id"));
    b.code((String) a.get("code"));
    b.rawValue(a.get("value"));
    b.currency((String) a.get("currency"));
    if (a.get("provider") != null) {
      b.provider(Provider.fromString((String) a.get("provider")));
    }
    b.isFirst((Boolean) a.get("is_first"));
    b.label((String) a.get("label"));
    b.keptBy((String) a.get("kept_by"));
    b.browserEngine((String) a.get("browser_engine"));
    b.platform((String) a.get("platform"));
    b.hashedEmail((String) a.get("hashed_email"));
    b.hashedPhoneE164((String) a.get("hashed_phone_e164"));
    b.hashedPhoneDigits((String) a.get("hashed_phone_digits"));
    b.rawOccurredAt(a.get("occurred_at"));
    b.metadata(a.get("metadata") == null ? null : map(a.get("metadata")));
    b.consent(a.get("consent") == null ? null : map(a.get("consent")));
    if (a.get("extra") != null) {
      for (Map.Entry<String, Object> e : map(a.get("extra")).entrySet()) {
        b.extra(e.getKey(), e.getValue());
      }
    }
    return b.build();
  }

  static PaymentConfirmParams payment(Map<String, Object> a) {
    PaymentConfirmParams.Builder b =
        PaymentConfirmParams.builder()
            .provider(a.get("provider") == null ? null : Provider.fromString((String) a.get("provider")))
            .reference((String) a.get("reference"))
            .status((String) a.get("status"))
            .rawAmount(a.get("amount"))
            .rawAmountMinor(a.get("amount_minor"))
            .currency((String) a.get("currency"))
            .rawOccurredAt(a.get("occurred_at"))
            .rawAliases(a.get("aliases") == null ? null : list(a.get("aliases")))
            .clickId((String) a.get("click_id"))
            .goal((String) a.get("goal"))
            .test((Boolean) a.get("test"));
    if (a.get("extra") != null) {
      for (Map.Entry<String, Object> e : map(a.get("extra")).entrySet()) {
        b.extra(e.getKey(), e.getValue());
      }
    }
    return b.build();
  }

  private static ClickIds.CookieOptions cookie(Map<String, Object> a) {
    ClickIds.CookieOptions o = ClickIds.CookieOptions.defaults();
    if (a.get("days") != null) {
      o = o.days(((Number) a.get("days")).doubleValue());
    }
    if (a.get("secure") != null) {
      o = o.secure((Boolean) a.get("secure"));
    }
    if (a.get("domain") != null) {
      o = o.domain((String) a.get("domain"));
    }
    return o;
  }

  private static Object canonical(Object r) {
    if (r instanceof WireObject) {
      return ((WireObject) r).toMap();
    }
    if (r instanceof LinkUpdateResult) {
      return ((LinkUpdateResult) r).toMap();
    }
    return r;
  }

  private static byte[] bytes(Object raw) {
    return raw instanceof byte[] ? (byte[]) raw : String.valueOf(raw).getBytes(StandardCharsets.UTF_8);
  }

  private static String moneyFormat(Object v) {
    if (v instanceof BigDecimal) {
      return Money.formatValue((BigDecimal) v);
    }
    if (v instanceof Number) {
      return Money.formatValue(((Number) v).longValue());
    }
    return Money.formatValue((String) v);
  }

  private Object step(Clikgate client, String call, Map<String, Object> a, long[] now) throws Exception {
    RequestOptions ro = a.get("idempotency_key") != null ? RequestOptions.builder().idempotencyKey((String) a.get("idempotency_key")).build() : RequestOptions.NONE;
    Map<String, Object> params = a.get("params") == null ? new LinkedHashMap<String, Object>() : map(a.get("params"));
    switch (call) {
      case "client.mode":
        return Collections.singletonMap("value", client.mode());
      case "goal":
        client.goal((String) a.get("key"), goal(a));
        return null;
      case "goals.send":
        return client.goals().send((String) a.get("key"), goal(a), ro);
      case "goals.send_batch":
        {
          List<GoalBatchEvent> events = new ArrayList<>();
          for (Object o : list(a.get("events"))) {
            Map<String, Object> e = map(o);
            events.add(GoalBatchEvent.of((String) e.get("goal"), goal(e)));
          }
          return client.goals().sendBatch(events);
        }
      case "goals.reverse":
        return client.goals().reverseWith((String) a.get("key"), String.valueOf(a.get("reference")), a.get("value"), (String) a.get("reason"), RequestOptions.NONE);
      case "flush":
        return Collections.singletonMap("value", client.flush(Duration.ofMillis(a.get("timeout_ms") == null ? 10_000 : ((Number) a.get("timeout_ms")).longValue())));
      case "close":
        return Collections.singletonMap("value", client.close(Duration.ofMillis(a.get("timeout_ms") == null ? 10_000 : ((Number) a.get("timeout_ms")).longValue())));
      case "advance_clock":
        now[0] += ((Number) a.get("ms")).longValue();
        return null;
      case "config.get":
        return client.config();
      case "conversions.create":
        return client.conversions().create(params, ro);
      case "conversions.reverse":
        return client.conversions().reverse((String) a.get("id"), params);
      case "links.create":
        return client.links().create(params, ro);
      case "links.get":
        return client.links().get((String) a.get("id"));
      case "links.update":
        return client.links().update((String) a.get("id"), params, ro);
      case "links.list":
        {
          List<Object> items = new ArrayList<>();
          Object max = a.get("max_items");
          for (com.clikgate.model.Link l : client.links().list(params)) {
            items.add(l.toMap());
            if (max != null && items.size() >= ((Number) max).intValue()) {
              break;
            }
          }
          return Collections.singletonMap("items", items);
        }
      case "links.list_page":
        return client.links().listPage(params);
      case "links.qr":
        {
          Map<String, Object> q = new LinkedHashMap<>(a);
          q.remove("id");
          QrCode qr = client.links().qr((String) a.get("id"), q);
          Map<String, Object> m = new LinkedHashMap<>();
          m.put("content_type", qr.getContentType());
          m.put("bytes_length", qr.getData().length);
          return m;
        }
      case "clicks.get":
        return client.clicks().get((String) a.get("id"));
      case "webhooks.verify":
        return Webhooks.verify(bytes(a.get("raw_body")), (String) a.get("header"), (String) a.get("secret"), ((Number) a.get("tolerance")).longValue(), ((Number) a.get("now")).longValue());
      case "webhooks.verify_any":
        {
          List<String> secrets = new ArrayList<>();
          for (Object o : list(a.get("secrets"))) {
            secrets.add((String) o);
          }
          return Webhooks.verifyAny(bytes(a.get("raw_body")), (String) a.get("header"), secrets, ((Number) a.get("tolerance")).longValue(), ((Number) a.get("now")).longValue());
        }
      case "click_ids.is_valid":
        return Collections.singletonMap("value", ClickIds.isValid(a.get("id")));
      case "click_ids.from_request":
        {
          Map<String, Object> r = map(a.get("request"));
          return Collections.singletonMap("value", client.clickIds().fromRequest((String) r.get("url"), map(r.get("headers"))));
        }
      case "click_ids.cookie_header":
        return Collections.singletonMap("value", client.clickIds().cookieHeader((String) a.get("id"), cookie(a)));
      case "click_ids.persist":
        {
          List<String> setCookie = new ArrayList<>();
          for (Object o : list(a.get("existing_set_cookie"))) {
            setCookie.add((String) o);
          }
          client.clickIds().persist((name, value) -> setCookie.add(value), (String) a.get("id"), cookie(a));
          return Collections.singletonMap("set_cookie", setCookie);
        }
      case "click_ids.from_payment_metadata":
        return Collections.singletonMap("value", client.clickIds().fromPaymentMetadata(a.get("payload")));
      case "click_ids.context":
        {
          Map<String, Object> r = map(a.get("request"));
          ClickContext c = client.clickIds().context((String) r.get("url"), map(r.get("headers")));
          Map<String, Object> out = new LinkedHashMap<>();
          out.put("click_id", c.getClickId());
          out.put("kept_by", c.getKeptBy());
          out.put("browser_engine", c.getBrowserEngine());
          out.put("platform", c.getPlatform());
          return out;
        }
      case "click_ids.keep":
        {
          Map<String, Object> r = map(a.get("request"));
          Map<String, Object> headers = map(r.get("headers"));
          Object rawBody = r.get("body");
          byte[] body = rawBody == null ? new byte[0] : ((String) rawBody).getBytes(StandardCharsets.UTF_8);
          KeepRoute.Response res =
              client
                  .clickIds()
                  .keepRoute(cookie(a))
                  .respond(
                      (String) r.get("method"),
                      name -> {
                        for (Map.Entry<String, Object> e : headers.entrySet()) {
                          if (e.getKey().equalsIgnoreCase(name)) {
                            return String.valueOf(e.getValue());
                          }
                        }
                        return null;
                      },
                      body);
          List<String> setCookie = new ArrayList<>();
          String cacheControl = null;
          String allow = null;
          String location = null;
          for (Map.Entry<String, String> h : res.getHeaders()) {
            if ("Set-Cookie".equalsIgnoreCase(h.getKey())) {
              setCookie.add(h.getValue());
            } else if ("Cache-Control".equalsIgnoreCase(h.getKey())) {
              cacheControl = h.getValue();
            } else if ("Allow".equalsIgnoreCase(h.getKey())) {
              allow = h.getValue();
            } else if ("Location".equalsIgnoreCase(h.getKey())) {
              location = h.getValue();
            }
          }
          Map<String, Object> out = new LinkedHashMap<>();
          out.put("status", res.getStatus());
          out.put("cache_control", cacheControl);
          out.put("set_cookie", setCookie);
          out.put("body", "");
          out.put("location", location);
          if (allow != null) {
            out.put("allow", allow);
          }
          return out;
        }
      case "hash_for_ads":
        {
          HashedIdentifiers h = HashForAds.hash((String) a.get("email"), (String) a.get("phone"));
          Map<String, Object> out = new LinkedHashMap<>();
          if (h.getHashedEmail() != null) {
            out.put("hashed_email", h.getHashedEmail());
          }
          if (h.getHashedPhoneE164() != null) {
            out.put("hashed_phone_e164", h.getHashedPhoneE164());
          }
          if (h.getHashedPhoneDigits() != null) {
            out.put("hashed_phone_digits", h.getHashedPhoneDigits());
          }
          return out;
        }
      case "money.format":
        return Collections.singletonMap("value", moneyFormat(a.get("value")));
      case "identify_user":
        return client.identifyUser(
            IdentifyUserParams.builder()
                .clickId((String) a.get("click_id"))
                .appId((String) a.get("app_id"))
                .installationId((String) a.get("installation_id"))
                .customerId((String) a.get("customer_id"))
                .label((String) a.get("label"))
                .build(),
            ro);
      case "payments.confirm":
        return client.payments().confirm(payment(a), ro);
      case "payments.from":
      case "payments.build":
        {
          PaymentHelperOptions o = PaymentHelperOptions.builder().goal((String) a.get("goal")).clickId((String) a.get("click_id")).build();
          String g = (String) a.get("gateway");
          Object r = a.get("response");
          if ("payments.build".equals(call)) {
            Map<String, Object> body =
                "paystack".equals(g) ? client.payments().buildFromPaystack(r, o)
                    : "flutterwave".equals(g) ? client.payments().buildFromFlutterwave(r, o)
                    : "monnify".equals(g) ? client.payments().buildFromMonnify(r, o) : client.payments().buildFromStripe(r, o);
            return Collections.singletonMap("value", body);
          }
          return "paystack".equals(g) ? client.payments().fromPaystack(r, o)
              : "flutterwave".equals(g) ? client.payments().fromFlutterwave(r, o)
              : "monnify".equals(g) ? client.payments().fromMonnify(r, o) : client.payments().fromStripe(r, o);
        }
      default:
        throw new IllegalStateException("runner: unknown call " + call);
    }
  }

  private Map<String, Object> runCase(Map<String, Object> c, int index) throws Exception {
    Map<String, Object> cl = map(c.get("client"));
    long[] now = {((Number) c.get("now_ms")).longValue()};
    List<Long> sleeps = new ArrayList<>();
    List<String> warnings = new ArrayList<>();
    List<String> logs = new ArrayList<>();
    List<Object> onError = new ArrayList<>();
    List<Object> rand = list(c.get("random"));
    int[] draw = {0};
    Clikgate.Builder b =
        Clikgate.builder()
            .baseUrl((String) cl.get("base_url"))
            .timeout(Duration.ofMillis(((Number) cl.get("timeout_ms")).longValue()))
            .maxRetries(((Number) cl.get("max_retries")).intValue())
            .sendMode("sync".equals(cl.get("send_mode")) ? SendMode.SYNC : SendMode.BACKGROUND)
            .privateMode(Boolean.TRUE.equals(cl.get("private_mode")) ? PrivateMode.ON : Boolean.FALSE.equals(cl.get("private_mode")) ? PrivateMode.OFF : PrivateMode.AUTO)
            .clickIdParam((String) cl.get("click_id_param"))
            .batchSize(((Number) cl.get("batch_size")).intValue())
            .flushInterval(Duration.ofMillis(((Number) cl.get("flush_interval_ms")).longValue()))
            .maxQueueSize(((Number) cl.get("max_queue_size")).intValue())
            .shutdownHooks(false)
            .noProxy()
            .logger(
                new ClikgateLogger() {
                  @Override
                  public void warn(String code, String message) {
                    warnings.add(code);
                    logs.add(message + " " + code);
                  }

                  @Override
                  public void error(String code, String message) {
                    logs.add(message + " " + code);
                  }
                })
            .onError(
                (e, ctx) -> {
                  Map<String, Object> m = serialiseError(e);
                  m.put("events", ctx.getEvents());
                  m.put("dropped", ctx.isDropped());
                  m.put("operation", ctx.getOperation());
                  onError.add(m);
                })
            .clock(
                new Clock() {
                  @Override
                  public long nowMillis() {
                    return now[0];
                  }

                  @Override
                  public void sleep(Duration d) {
                    sleeps.add(d.toMillis());
                  }
                })
            .random(
                () -> {
                  double r = rand.isEmpty() ? 0.5 : ((Number) rand.get(draw[0] % rand.size())).doubleValue();
                  draw[0]++;
                  return r;
                });
    if (cl.get("api_key") != null) {
      b.apiKey((String) cl.get("api_key"));
    }
    Map<String, Object> outcome = new LinkedHashMap<>();
    outcome.put("case_id", c.get("id"));
    outcome.put("language", "java");
    Clikgate client;
    try {
      client = b.build();
    } catch (RuntimeException e) {
      outcome.put("construct_error", serialiseError(e));
      outcome.put("steps", Collections.emptyList());
      outcome.put("sleeps_ms", sleeps);
      outcome.put("warnings", warnings);
      outcome.put("logs", logs);
      outcome.put("on_error", onError);
      return map(control("/finish", outcome));
    }
    List<Object> steps = new ArrayList<>();
    for (Object s : list(c.get("steps"))) {
      Map<String, Object> step = map(s);
      Map<String, Object> a = map(decode(step.get("args") == null ? new LinkedHashMap<String, Object>() : step.get("args")));
      Map<String, Object> rec = new LinkedHashMap<>();
      try {
        rec.put("result", canonical(step(client, (String) step.get("call"), a, now)));
      } catch (Exception e) {
        rec.put("error", serialiseError(e));
      }
      steps.add(rec);
    }
    outcome.put("construct_error", null);
    outcome.put("steps", steps);
    outcome.put("sleeps_ms", new ArrayList<>(sleeps));
    outcome.put("warnings", new ArrayList<>(warnings));
    outcome.put("logs", new ArrayList<>(logs));
    outcome.put("on_error", new ArrayList<>(onError));
    Map<String, Object> verdict = map(control("/finish", outcome));
    client.close(Duration.ofSeconds(1));
    return verdict;
  }

  @Test
  void conformance() throws Exception {
    File mock = new File("../../conformance/mock-server/server.mjs").getCanonicalFile();
    assertTrue(mock.isFile(), "mock server not found at " + mock);
    ProcessBuilder pb = new ProcessBuilder("node", mock.getPath(), "--port", "0");
    for (String k : new String[] {"CLIKGATE_API_KEY", "CLIKGATE_BASE_URL", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"}) {
      pb.environment().remove(k);
    }
    pb.redirectError(ProcessBuilder.Redirect.INHERIT);
    Process child = pb.start();
    String filter = System.getProperty("clikgate.conformance.filter", "");
    int passed = 0;
    int failed = 0;
    StringBuilder report = new StringBuilder();
    try {
      BufferedReader out = new BufferedReader(new InputStreamReader(child.getInputStream(), StandardCharsets.UTF_8));
      Pattern ready = Pattern.compile("^CLIKGATE_MOCK_READY (.*)$");
      for (String line; (line = out.readLine()) != null; ) {
        Matcher m = ready.matcher(line.trim());
        if (m.matches()) {
          base = "http://127.0.0.1:" + map(Json.parse(m.group(1))).get("port");
          break;
        }
      }
      assertTrue(!base.isEmpty(), "the mock server did not start");
      List<Object> cases = list(map(control("/cases?language=java", null)).get("cases"));
      int i = 0;
      for (Object o : cases) {
        Map<String, Object> c = map(o);
        if (!filter.isEmpty() && !String.valueOf(c.get("id")).contains(filter)) {
          continue;
        }
        Map<String, Object> started = map(control("/start", Collections.singletonMap("case_id", c.get("id"))));
        Map<String, Object> verdict = runCase(started, i++);
        if (Boolean.TRUE.equals(verdict.get("ok"))) {
          passed++;
        } else {
          failed++;
          report.append("FAIL ").append(c.get("id")).append(": ").append(c.get("description")).append("\n  - ");
          List<String> f = new ArrayList<>();
          for (Object x : list(verdict.get("failures"))) {
            f.add(String.valueOf(x));
          }
          report.append(String.join("\n  - ", f)).append('\n');
        }
      }
    } finally {
      child.destroy();
    }
    System.out.print(report);
    System.out.println("\nconformance (java): " + passed + " passed, " + failed + " failed, " + (passed + failed) + " total");
    assertEquals(0, failed, report.toString());
    assertTrue(passed > 0, "no cases ran");
  }
}
