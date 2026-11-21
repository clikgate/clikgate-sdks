package com.clikgate.servlet.javax;

import com.clikgate.Installation;
import java.util.Enumeration;
import javax.servlet.http.HttpServletRequest;
import org.jspecify.annotations.Nullable;

/**
 * The app's {@code Clikgate-Installation} header (SPEC section 24.1) from a servlet request, for
 * {@code identifyUser}. Call it after your own sign-in check; the customer ID always comes from your signed-in user,
 * never from the request.
 *
 * <pre>{@code
 * Installation installation = ClikgateInstallations.from(request);   // null when missing or invalid
 * if (installation != null) {
 *   clikgate.identifyUser(IdentifyUserParams.builder().installation(installation).customerId(user.getId()).build());
 * }
 * }</pre>
 */
public final class ClikgateInstallations {
  private ClikgateInstallations() {}

  /**
   * The installation from the request's {@code Clikgate-Installation} header, or null when it is missing, invalid or
   * sent more than once. Never throws.
   */
  public static @Nullable Installation from(@Nullable HttpServletRequest request) {
    if (request == null) return null;
    try {
      Enumeration<String> values = request.getHeaders(Installation.HEADER);
      if (values == null || !values.hasMoreElements()) return null;
      String value = values.nextElement();
      // Several headers with this name: refused, never guessed
      if (values.hasMoreElements()) return null;
      return Installation.parseHeader(value);
    } catch (RuntimeException e) {
      return null;
    }
  }
}
