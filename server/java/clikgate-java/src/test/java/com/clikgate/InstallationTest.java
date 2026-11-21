package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.clikgate.exception.ConflictException;
import com.clikgate.exception.InvalidRequestException;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import com.clikgate.internal.Json;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;

/** The Clikgate-Installation header: the parser and identifyUser's installation parameter. */
class InstallationTest {
  private static final String KEY = "cg_test_unit000000000000";
  private static final String APP = "app_01JCK8Z9V7Q4M2N6P8R0S2T4AP";
  private static final String INST = "6a1f0c2e-0000-4000-8000-000000000001";
  private static final String HEADER = APP + ":" + INST;

  static final class Script implements Transport {
    final List<TransportRequest> requests = new CopyOnWriteArrayList<>();
    final int status;
    final String answer;

    Script(int status, String answer) {
      this.status = status;
      this.answer = answer;
    }

    @Override
    public TransportResponse send(TransportRequest request) {
      requests.add(request);
      return new TransportResponse(status, Collections.singletonMap("content-type", "application/json"), answer.getBytes(StandardCharsets.UTF_8));
    }

    List<Object> bodies() throws Exception {
      List<Object> out = new ArrayList<>();
      for (TransportRequest r : requests) {
        if (r.getBody() != null) out.add(Json.parse(r.getBody()));
      }
      return out;
    }
  }

  private static Clikgate client(Script s) {
    return Clikgate.builder().apiKey(KEY).transport(s).privateMode(PrivateMode.OFF).shutdownHooks(false).maxRetries(0).build();
  }

  private static String repeat(char c, int n) {
    char[] chars = new char[n];
    Arrays.fill(chars, c);
    return new String(chars);
  }

  private static Map<String, Object> body(String... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
    return m;
  }

  @Test
  void parseAcceptsTheContractTrimmed() {
    for (String value : new String[] {HEADER, "\t" + HEADER + "  ", "\r\n\u000B" + HEADER + "\f"}) {
      Installation i = Installation.parseHeader(value);
      assertNotNull(i, value);
      assertEquals(APP, i.getAppId());
      assertEquals(INST, i.getInstallationId());
    }
    assertEquals("Clikgate-Installation", Installation.HEADER);
  }

  @Test
  void parseRefusesAnythingElse() {
    String[] bad = {
      APP + ":" + INST.toUpperCase(),
      APP.toLowerCase() + ":" + INST,
      HEADER + ":x",
      APP + "::" + INST,
      APP + INST,
      APP + ":",
      ":" + INST,
      "cli_01JCK8Z9V7Q4M2N6P8R0S2T4AP:" + INST,
      repeat(' ', 70) + HEADER,
      HEADER + "\n" + HEADER,
      HEADER + ", " + HEADER,
      " " + HEADER,
      HEADER + " ",
      "",
      "   ",
      repeat('x', 10_000),
      null,
    };
    for (String value : bad) {
      assertNull(Installation.parseHeader(value), String.valueOf(value).length() > 80 ? "long" : value);
    }
  }

  @Test
  @SuppressWarnings("unchecked")
  void identifyUserWithTheHeaderAndWithoutAppId() throws Exception {
    Script s = new Script(200, "{\"object\":\"person_identified\",\"person_id\":\"per_1\",\"label_ignored\":null}");
    Clikgate c = client(s);
    c.identifyUser(IdentifyUserParams.builder().installation(" " + HEADER + " ").customerId("user_42").build());
    c.identifyUser(IdentifyUserParams.builder().installationId(INST).customerId("user_42").build());
    c.identifyUser(IdentifyUserParams.builder().installation(HEADER).installationId("6a1f0c2e-0000-4000-8000-000000000002").customerId("user_42").build());
    c.identifyUser(IdentifyUserParams.builder().installation("secret-header-value").clickId("clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6").build());
    c.identifyUser(IdentifyUserParams.builder().appId(APP).installationId(INST).customerId("user_42").build());
    c.identifyUser(IdentifyUserParams.builder().installation(Installation.parseHeader(HEADER)).customerId("user_42").build());
    List<Object> bodies = s.bodies();
    assertEquals(body("app_id", APP, "installation_id", INST, "customer_id", "user_42"), bodies.get(0));
    assertEquals(body("installation_id", INST, "customer_id", "user_42"), bodies.get(1));
    assertEquals(body("installation_id", "6a1f0c2e-0000-4000-8000-000000000002", "customer_id", "user_42"), bodies.get(2));
    assertEquals(body("click_id", "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6"), bodies.get(3));
    assertEquals(body("app_id", APP, "installation_id", INST, "customer_id", "user_42"), bodies.get(4));
    assertEquals(body("app_id", APP, "installation_id", INST, "customer_id", "user_42"), bodies.get(5));
    InvalidRequestException none = assertThrows(InvalidRequestException.class, () -> c.identifyUser(IdentifyUserParams.builder().installation("secret-header-value").build()));
    assertEquals("click_id", none.getParam());
    assertFalse(none.getMessage().contains("secret-header-value"));
    InvalidRequestException appOnly = assertThrows(InvalidRequestException.class, () -> c.identifyUser(IdentifyUserParams.builder().appId(APP).build()));
    assertEquals("installation_id", appOnly.getParam());
    assertEquals(6, s.requests.size());
  }

  @Test
  void severalAppsIsAConflict() {
    Script s = new Script(409, "{\"error\":{\"type\":\"conflict\",\"code\":\"installation_in_several_apps\",\"message\":\"Send app_id.\",\"param\":\"app_id\",\"request_id\":\"req_1\"}}");
    ConflictException e = assertThrows(ConflictException.class, () -> client(s).identifyUser(IdentifyUserParams.builder().installationId(INST).customerId("user_42").build()));
    assertEquals("installation_in_several_apps", e.getCode());
    assertEquals("app_id", e.getParam());
    assertEquals(Integer.valueOf(409), e.getHttpStatus());
  }
}
