package com.clikgate.servlet.jakarta;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;

class ClikgateFilterTest {
  private static final String CID = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";

  private static HttpServletRequest request(String uri, String query, Map<String, String> headers, Map<String, Object> attributes, boolean secure) {
    return (HttpServletRequest)
        Proxy.newProxyInstance(
            ClikgateFilterTest.class.getClassLoader(),
            new Class<?>[] {HttpServletRequest.class},
            (p, m, a) -> {
              switch (m.getName()) {
                case "getRequestURI":
                  return uri;
                case "getQueryString":
                  return query;
                case "getHeader":
                  for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey().equalsIgnoreCase((String) a[0])) {
                      return e.getValue();
                    }
                  }
                  return null;
                case "setAttribute":
                  attributes.put((String) a[0], a[1]);
                  return null;
                case "getAttribute":
                  return attributes.get((String) a[0]);
                case "isSecure":
                  return secure;
                default:
                  throw new UnsupportedOperationException(m.getName());
              }
            });
  }

  private static HttpServletResponse response(List<String> setCookie) {
    return (HttpServletResponse)
        Proxy.newProxyInstance(
            ClikgateFilterTest.class.getClassLoader(),
            new Class<?>[] {HttpServletResponse.class},
            (p, m, a) -> {
              if ("addHeader".equals(m.getName()) && "Set-Cookie".equals(a[0])) {
                setCookie.add((String) a[1]);
                return null;
              }
              throw new UnsupportedOperationException(m.getName());
            });
  }

  @Test
  void capturesAndPersistsFromTheQuery() throws Exception {
    Map<String, Object> attributes = new HashMap<>();
    List<String> cookies = new ArrayList<>();
    FilterChain chain = (rq, rs) -> {};
    HttpServletRequest req = request("/landing", "cgid=" + CID, new HashMap<>(), attributes, true);
    new ClikgateFilter().doFilter(req, response(cookies), chain);
    assertEquals(CID, ClikgateFilter.clickId(req));
    assertEquals("_cg_cgid=" + CID + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure", cookies.get(0));
    assertEquals("_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure", cookies.get(1));
  }

  @Test
  void readsTheCookieWithoutRewritingIt() throws Exception {
    Map<String, Object> attributes = new HashMap<>();
    List<String> cookies = new ArrayList<>();
    Map<String, String> headers = new HashMap<>();
    headers.put("Cookie", "a=1; _cg_cgid=" + CID);
    HttpServletRequest req = request("/", null, headers, attributes, false);
    new ClikgateFilter().doFilter(req, response(cookies), (rq, rs) -> {});
    assertEquals(CID, attributes.get(ClikgateFilter.ATTRIBUTE));
    assertEquals(0, cookies.size());
    HttpServletRequest none = request("/", null, new HashMap<>(), new HashMap<>(), false);
    new ClikgateFilter().doFilter(none, response(cookies), (rq, rs) -> {});
    assertNull(ClikgateFilter.clickId(none));
  }
}
