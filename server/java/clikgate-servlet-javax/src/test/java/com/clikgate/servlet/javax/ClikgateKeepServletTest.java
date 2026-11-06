package com.clikgate.servlet.javax;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.ByteArrayInputStream;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import javax.servlet.ReadListener;
import javax.servlet.ServletInputStream;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;

class ClikgateKeepServletTest {
  private static final String CID = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";
  private static final String BODY = "{\"click_id\":\"" + CID + "\",\"page_click_id\":\"" + CID + "\"}";

  /** What the servlet sent: status and headers in order. */
  static final class Sent {
    int status = 200;
    final List<String[]> headers = new ArrayList<>();
    boolean redirected;
    boolean wroteBody;

    List<String> all(String name) {
      List<String> out = new ArrayList<>();
      for (String[] h : headers) {
        if (h[0].equalsIgnoreCase(name)) {
          out.add(h[1]);
        }
      }
      return out;
    }
  }

  private static HttpServletRequest request(String method, Map<String, String> headers, String body) {
    ByteArrayInputStream bytes = new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
    ServletInputStream in =
        new ServletInputStream() {
          @Override
          public int read() {
            return bytes.read();
          }

          @Override
          public int read(byte[] b, int off, int len) {
            return bytes.read(b, off, len);
          }

          @Override
          public boolean isFinished() {
            return bytes.available() == 0;
          }

          @Override
          public boolean isReady() {
            return true;
          }

          @Override
          public void setReadListener(ReadListener l) {}
        };
    return (HttpServletRequest)
        Proxy.newProxyInstance(
            ClikgateKeepServletTest.class.getClassLoader(),
            new Class<?>[] {HttpServletRequest.class},
            (p, m, a) -> {
              switch (m.getName()) {
                case "getMethod":
                  return method;
                case "getInputStream":
                  return in;
                case "getHeader":
                  for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey().equalsIgnoreCase((String) a[0])) {
                      return e.getValue();
                    }
                  }
                  return null;
                default:
                  throw new UnsupportedOperationException(m.getName());
              }
            });
  }

  private static HttpServletResponse response(Sent sent) {
    return (HttpServletResponse)
        Proxy.newProxyInstance(
            ClikgateKeepServletTest.class.getClassLoader(),
            new Class<?>[] {HttpServletResponse.class},
            (p, m, a) -> {
              switch (m.getName()) {
                case "setStatus":
                  sent.status = (Integer) a[0];
                  return null;
                case "addHeader":
                case "setHeader":
                  sent.headers.add(new String[] {(String) a[0], (String) a[1]});
                  return null;
                case "setContentLength":
                  return null;
                case "sendRedirect":
                  sent.redirected = true;
                  return null;
                case "getWriter":
                case "getOutputStream":
                  sent.wroteBody = true;
                  throw new UnsupportedOperationException(m.getName());
                default:
                  throw new UnsupportedOperationException(m.getName());
              }
            });
  }

  private static Sent keep(ClikgateKeepServlet servlet, String method, Map<String, String> headers, String body) throws Exception {
    Sent sent = new Sent();
    headers.putIfAbsent("Host", "shop.example.com");
    servlet.service(request(method, headers, body), response(sent));
    assertEquals("no-store, private", String.join(",", sent.all("Cache-Control")));
    assertTrue(sent.all("Location").isEmpty());
    assertFalse(sent.redirected);
    assertFalse(sent.wroteBody);
    return sent;
  }

  private static Map<String, String> headers(String... kv) {
    Map<String, String> m = new HashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put(kv[i], kv[i + 1]);
    }
    return m;
  }

  @Test
  void setsTheCookieAndTheMarker() throws Exception {
    Sent sent = keep(new ClikgateKeepServlet(), "POST", headers("Sec-Fetch-Site", "same-origin"), BODY);
    assertEquals(204, sent.status);
    List<String> cookies = sent.all("Set-Cookie");
    assertEquals(2, cookies.size());
    assertEquals("_cg_cgid=" + CID + "; Path=/; Max-Age=2592000; SameSite=Lax; Secure", cookies.get(0));
    assertEquals("_cg_kept=s; Path=/; Max-Age=2592000; SameSite=Lax; Secure", cookies.get(1));
    assertFalse(cookies.get(0).contains("HttpOnly"));
  }

  @Test
  void checksTheOriginAgainstTheHost() throws Exception {
    assertEquals(204, keep(new ClikgateKeepServlet(), "POST", headers("Origin", "https://shop.example.com"), BODY).status);
    assertEquals(403, keep(new ClikgateKeepServlet(), "POST", headers("Origin", "https://shop.example.com:8443"), BODY).status);
    assertEquals(403, keep(new ClikgateKeepServlet(), "POST", headers("Origin", "https://evil.example.net"), BODY).status);
    assertEquals(403, keep(new ClikgateKeepServlet(), "POST", headers(), BODY).status);
    assertEquals(403, keep(new ClikgateKeepServlet(), "POST", headers("Sec-Fetch-Site", "cross-site", "Origin", "https://shop.example.com"), BODY).status);
    assertTrue(keep(new ClikgateKeepServlet(), "POST", headers("Origin", "null"), BODY).all("Set-Cookie").isEmpty());
  }

  @Test
  void refusesOtherMethodsAndBadBodiesWithoutEcho() throws Exception {
    Sent get = keep(new ClikgateKeepServlet(), "GET", headers("Sec-Fetch-Site", "same-origin"), "");
    assertEquals(405, get.status);
    assertEquals("POST", String.join(",", get.all("Allow")));
    String script = "{\"click_id\":\"<script>alert(1)</script>\",\"page_click_id\":\"<script>alert(1)</script>\"}";
    StringBuilder big = new StringBuilder(BODY.substring(0, BODY.length() - 1)).append(",\"pad\":\"");
    while (big.length() < 1100) {
      big.append('x');
    }
    big.append("\"}");
    for (String body : new String[] {script, "[]", "not json", big.toString(), "{\"click_id\":\"" + CID + "\"}"}) {
      Sent sent = keep(new ClikgateKeepServlet(), "POST", headers("Sec-Fetch-Site", "same-origin"), body);
      assertEquals(400, sent.status, body);
      assertTrue(sent.all("Set-Cookie").isEmpty());
      for (String[] h : sent.headers) {
        assertFalse(h[1].contains("script"));
      }
    }
  }
}
