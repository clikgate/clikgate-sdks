package com.clikgate;

import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * An app installation from the {@code Clikgate-Installation} header (SPEC section 24.1).
 *
 * <p>The mobile SDKs give the app a value {@code <app_id>:<installation_id>} to send to its own backend at sign-in and
 * on signed-in requests. It is not a secret. Pass it to {@link IdentifyUserParams.Builder#installation(String)}, so
 * your server never needs to know which Clikgate app ID belongs to which platform. The header only names the app
 * installation: the customer ID always comes from your own signed-in user, never from the request.
 *
 * <pre>{@code
 * Installation installation = Installation.parseHeader(request.getHeader(Installation.HEADER)); // or null
 * }</pre>
 */
public final class Installation {
  /** The header name the app sends to your backend. */
  public static final String HEADER = "Clikgate-Installation";

  /** Longer header values are refused before they are looked at. */
  public static final int MAX_LENGTH = 128;

  /** {@code app_} + a 26-character ID, one colon, a lowercase UUID. */
  public static final Pattern PATTERN =
      Pattern.compile("(app_[0-9A-Z]{26}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})");

  private final String appId;
  private final String installationId;

  private Installation(String appId, String installationId) {
    this.appId = appId;
    this.installationId = installationId;
  }

  /**
   * Parse a {@code Clikgate-Installation} header value. Null for anything that isn't exactly
   * {@code <app_id>:<installation_id>} (after trimming, at most 128 characters, lowercase UUID). Never throws.
   *
   * <pre>{@code
   * Installation installation = Installation.parseHeader(value);
   * }</pre>
   */
  public static @Nullable Installation parseHeader(@Nullable String value) {
    if (value == null || value.length() > MAX_LENGTH) return null;
    Matcher m = PATTERN.matcher(trim(value));
    if (!m.matches()) return null;
    return new Installation(m.group(1), m.group(2));
  }

  /** Leading and trailing ASCII whitespace (space, tab, CR, LF, form feed, vertical tab) removed. */
  private static String trim(String value) {
    int start = 0;
    int end = value.length();
    while (start < end && " \t\r\n\f\u000B".indexOf(value.charAt(start)) >= 0) start++;
    while (end > start && " \t\r\n\f\u000B".indexOf(value.charAt(end - 1)) >= 0) end--;
    return value.substring(start, end);
  }

  /** The Clikgate app ID ({@code app_...}). */
  public String getAppId() {
    return appId;
  }

  /** The SDK's installation ID (a lowercase UUID). */
  public String getInstallationId() {
    return installationId;
  }

  @Override
  public boolean equals(@Nullable Object o) {
    if (this == o) return true;
    if (!(o instanceof Installation)) return false;
    Installation other = (Installation) o;
    return appId.equals(other.appId) && installationId.equals(other.installationId);
  }

  @Override
  public int hashCode() {
    return Objects.hash(appId, installationId);
  }

  @Override
  public String toString() {
    return "Installation{appId=" + appId + ", installationId=" + installationId + "}";
  }
}
