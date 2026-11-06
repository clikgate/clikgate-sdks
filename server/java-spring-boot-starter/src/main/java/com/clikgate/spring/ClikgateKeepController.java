package com.clikgate.spring;

import com.clikgate.KeepRoute;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

/**
 * The {@code /cg/keep} route (SPEC 13.1, change 16), auto-configured when {@code clikgate.keep-route.enabled=true}.
 * The web script's {@code data-server-endpoint="/cg/keep"} posts the click ID here, and the response sets the
 * {@code _cg_<param>} cookie and the {@code _cg_kept=s} marker from your server.
 *
 * <p>Every method is mapped so the route answers {@code 405} itself (with {@code Allow: POST} and
 * {@code Cache-Control: no-store, private}). With Spring Security, exclude the path from CSRF
 * ({@code csrf.ignoringRequestMatchers("/cg/keep")}) and permit it: the route checks {@code Sec-Fetch-Site} /
 * {@code Origin} itself, accepts nothing but a click ID and changes nothing but these two cookies.
 */
@Controller
public class ClikgateKeepController {
  private final KeepRoute route;

  public ClikgateKeepController(KeepRoute route) {
    this.route = route;
  }

  @RequestMapping(path = "${clikgate.keep-route.path:/cg/keep}")
  public void keep(HttpServletRequest request, HttpServletResponse response) throws IOException {
    byte[] body = "POST".equalsIgnoreCase(request.getMethod()) ? read(request.getInputStream()) : new byte[0];
    KeepRoute.Response out = route.respond(request.getMethod(), request::getHeader, body);
    response.setStatus(out.getStatus());
    for (Map.Entry<String, String> h : out.getHeaders()) {
      response.addHeader(h.getKey(), h.getValue());
    }
    if (out.getStatus() != 204) {
      response.setContentLength(0);
    }
  }

  private static byte[] read(InputStream in) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream();
    byte[] chunk = new byte[256];
    int n;
    while (buf.size() <= KeepRoute.MAX_BODY && (n = in.read(chunk, 0, Math.min(chunk.length, KeepRoute.MAX_BODY + 1 - buf.size()))) > 0) {
      buf.write(chunk, 0, n);
    }
    return buf.toByteArray();
  }
}
