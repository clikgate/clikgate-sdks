package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.InvalidRequestException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Change 16: the {@code /cg/keep} core, the {@code _cg_kept=s} marker and {@code clickIds().context()} (SPEC 13, 13.1). */
class KeepRouteTest {
  private static final String CID = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";
  private static final String COOKIE = "_cg_cgid=" + CID + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure";
  private static final String MARKER = "_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure";

  private static byte[] body(String id, String page) {
    return ("{\"click_id\":\"" + id + "\",\"page_click_id\":\"" + page + "\"}").getBytes(StandardCharsets.UTF_8);
  }

  private static KeepRoute.Response keep(KeepRoute route, String method, byte[] body, String... kv) {
    Map<String, String> h = new HashMap<>();
    h.put("host", "shop.example.com");
    for (int i = 0; i < kv.length; i += 2) {
      h.put(kv[i].toLowerCase(), kv[i + 1]);
    }
    KeepRoute.Response r = route.respond(method, name -> h.get(name.toLowerCase()), body);
    assertEquals("Cache-Control", r.getHeaders().get(0).getKey());
    assertEquals("no-store, private", r.getHeaders().get(0).getValue());
    for (Map.Entry<String, String> e : r.getHeaders()) {
      assertTrue(!"Location".equalsIgnoreCase(e.getKey()));
    }
    return r;
  }

  private static List<String> cookies(KeepRoute.Response r) {
    List<String> out = new ArrayList<>();
    for (Map.Entry<String, String> e : r.getHeaders()) {
      if ("Set-Cookie".equals(e.getKey())) {
        out.add(e.getValue());
      }
    }
    return out;
  }

  @Test
  void sameOriginSetsTheCookieAndTheMarker() {
    KeepRoute.Response r = keep(new ClickIds().keepRoute(), "POST", body(CID, CID), "Sec-Fetch-Site", "same-origin");
    assertEquals(204, r.getStatus());
    assertEquals(Arrays.asList(COOKIE, MARKER), cookies(r));
  }

  @Test
  void originMustMatchTheHostAndPort() {
    KeepRoute route = new ClickIds().keepRoute();
    assertEquals(204, keep(route, "POST", body(CID, CID), "Origin", "https://SHOP.example.com").getStatus());
    assertEquals(204, keep(route, "POST", body(CID, CID), "Origin", "https://shop.example.com", "X-Forwarded-Host", "shop.example.com, lb.internal", "Host", "lb.internal").getStatus());
    for (String origin : new String[] {"https://shop.example.com:8443", "https://evil.example.net", "null"}) {
      KeepRoute.Response r = keep(route, "POST", body(CID, CID), "Origin", origin);
      assertEquals(403, r.getStatus(), origin);
      assertTrue(cookies(r).isEmpty());
    }
    assertEquals(403, keep(route, "POST", body(CID, CID)).getStatus());
    assertEquals(403, keep(route, "POST", body(CID, CID), "Sec-Fetch-Site", "same-site").getStatus());
    assertEquals(403, keep(route, "POST", body(CID, CID), "Sec-Fetch-Site", "cross-site", "Origin", "https://shop.example.com").getStatus());
  }

  @Test
  void onlyPostAndOnlyGoodBodies() {
    KeepRoute route = new ClickIds().keepRoute();
    KeepRoute.Response get = keep(route, "GET", new byte[0], "Sec-Fetch-Site", "same-origin");
    assertEquals(405, get.getStatus());
    assertEquals("Allow", get.getHeaders().get(1).getKey());
    assertEquals("POST", get.getHeaders().get(1).getValue());
    byte[] big = new byte[1025];
    Arrays.fill(big, (byte) ' ');
    System.arraycopy(body(CID, CID), 0, big, 0, body(CID, CID).length);
    List<byte[]> bad =
        Arrays.asList(
            body(CID, "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W7"), body("<script>", "<script>"), body(CID.toLowerCase(), CID.toLowerCase()), "[]".getBytes(StandardCharsets.UTF_8), "x".getBytes(StandardCharsets.UTF_8), big, new byte[0]);
    for (byte[] b : bad) {
      KeepRoute.Response r = keep(route, "POST", b, "Sec-Fetch-Site", "same-origin");
      assertEquals(400, r.getStatus());
      assertEquals(1, r.getHeaders().size()); // only Cache-Control: nothing echoed
    }
  }

  @Test
  void optionsAndConfiguredName() {
    ClickIds ref = new ClickIds(() -> "ref");
    KeepRoute route = ref.keepRoute(ClickIds.CookieOptions.defaults().days(90).secure(false).domain(".example.com"));
    KeepRoute.Response r = keep(route, "POST", ("{\"click_id\":\"" + CID + "\",\"page_click_id\":\"" + CID + "\",\"name\":\"session\"}").getBytes(StandardCharsets.UTF_8), "Sec-Fetch-Site", "same-origin");
    assertEquals(
        Arrays.asList("_cg_ref=" + CID + "; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax", "_cg_kept=s; Path=/; Max-Age=7776000; Domain=.example.com; SameSite=Lax"), cookies(r));
    for (double days : new double[] {0, 401, 1.5}) {
      InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> new ClickIds().keepRoute(ClickIds.CookieOptions.defaults().days(days)));
      assertEquals("invalid_argument", e.getCode());
    }
  }

  @Test
  void persistAddsTheMarker() {
    List<String> set = new ArrayList<>();
    new ClickIds().persist((n, v) -> set.add(v), CID, ClickIds.CookieOptions.defaults());
    assertEquals(Arrays.asList(COOKIE, MARKER), set);
  }

  @Test
  void contextAndGoalOptions() {
    Map<String, Object> h = new HashMap<>();
    h.put("Cookie", "_cg_cgid=" + CID + "; _cg_kept=s");
    h.put("User-Agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0 Mobile/15E148 Safari/604.1");
    ClickContext c = new ClickIds().context("/checkout", h);
    assertEquals(CID, c.getClickId());
    assertEquals("server_cookie", c.getKeptBy());
    assertEquals("webkit_ios", c.getBrowserEngine());
    assertEquals("ios", c.getPlatform());
    h.put("Cookie", "_cg_cgid=" + CID);
    assertEquals("script_cookie", new ClickIds().context("/", h).getKeptBy());
    Map<String, Object> form = new HashMap<>();
    form.put("clikgate-click-id", CID);
    assertEquals("form", new ClickIds().context("/", form).getKeptBy());
    ClickContext fromUrl = new ClickIds().context("/?cgid=" + CID, new HashMap<String, Object>());
    assertNull(fromUrl.getKeptBy());
    assertEquals("other", fromUrl.getBrowserEngine());
    assertEquals("safari_mac", ClickIds.browserEngine("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"));
    assertEquals("linux", ClickIds.platform("Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0"));

    Map<String, Object> wire = Goals.wire("account_opened", Goal.builder().reference("R-1").context(c).build());
    assertEquals(CID, wire.get("click_id"));
    assertEquals("server_cookie", wire.get("kept_by"));
    assertEquals("webkit_ios", wire.get("browser_engine"));
    assertEquals("ios", wire.get("platform"));
    assertThrows(InvalidRequestException.class, () -> Goals.wire("account_opened", Goal.builder().reference("R-1").keptBy("local_storage").build()));
    com.clikgate.internal.Guard.check("goal", wire); // allowed in private mode
  }
}
