package com.clikgate;

import com.clikgate.exception.ClikgateServerOnlyException;
import com.clikgate.exception.ConfigurationException;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Json;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.jspecify.annotations.Nullable;

/**
 * Identity tokens (SDK spec 8.5): your server proves to Clikgate that a customer ID belongs to the
 * person signed in to your app. The app passes the token to the mobile SDK's {@code identifyUser()}.
 *
 * <p>{@code token = base64url_nopad(HMAC_SHA256(secret, customerId + "." + issuedAt)) + "." + issuedAt}, the signer
 * Clikgate verifies with. No network call and no API key needed. Guide: https://clikgate.com/docs/identify-users
 *
 * <pre>{@code
 * String token = IdentityTokens.create(user.getId());             // CLIKGATE_IDENTITY_SECRET
 * String token = IdentityTokens.create(user.getId(), "app_…");    // that app's secret from CLIKGATE_IDENTITY_SECRETS
 * }</pre>
 *
 * <p>Throws {@link ClikgateServerOnlyException} in an Android app, {@link ConfigurationException} when no secret is
 * set, and {@code InvalidRequestException} ({@code invalid_customer_id}) for an empty or over-long customer ID.
 */
public final class IdentityTokens {
  /** The single secret's environment variable. */
  public static final String SECRET_ENV = "CLIKGATE_IDENTITY_SECRET";
  /** The per-app map's environment variable: a JSON object {@code {"app_…": "cgis_…"}}. */
  public static final String SECRETS_ENV = "CLIKGATE_IDENTITY_SECRETS";
  /** The class whose presence means an Android app. */
  static final String ANDROID_MARKER = "android.os.Build";

  private static final int MAX_CUSTOMER_ID = 255;
  private static volatile @Nullable Boolean onAndroid;

  private IdentityTokens() {}

  /** A token for {@code customerId}, signed with {@code CLIKGATE_IDENTITY_SECRET}, issued now. */
  public static String create(String customerId) {
    return create(customerId, null);
  }

  /** A token for {@code customerId}, signed with {@code appId}'s secret from {@code CLIKGATE_IDENTITY_SECRETS} (else {@code CLIKGATE_IDENTITY_SECRET}), issued now. */
  public static String create(String customerId, @Nullable String appId) {
    return createWith(onAndroid(), null, null, System::getenv, customerId, appId, null, null);
  }

  /** A token signed with an explicit secret and issue time (Unix seconds). */
  public static String create(String customerId, String secret, long issuedAtSeconds) {
    return createWith(onAndroid(), null, null, System::getenv, customerId, null, secret, issuedAtSeconds);
  }

  static boolean onAndroid() {
    Boolean v = onAndroid;
    if (v == null) {
      v = classPresent(ANDROID_MARKER);
      onAndroid = v;
    }
    return v;
  }

  static boolean classPresent(String name) {
    try {
      Class.forName(name, false, IdentityTokens.class.getClassLoader());
      return true;
    } catch (ClassNotFoundException | LinkageError e) {
      return false;
    }
  }

  static String createWith(
      boolean android,
      @Nullable String ownSecret,
      @Nullable Map<String, String> ownSecrets,
      Function<String, @Nullable String> env,
      @Nullable String customerId,
      @Nullable String appId,
      @Nullable String secret,
      @Nullable Long issuedAt) {
    if (android) {
      throw new ClikgateServerOnlyException(
          "createIdentityToken() runs on your server only: it needs your identity secret, which must never be in an app or website. Return the token from your sign-in response instead. See https://clikgate.com/docs/identify-users",
          "server_only");
    }
    if (customerId == null || customerId.isEmpty() || customerId.codePointCount(0, customerId.length()) > MAX_CUSTOMER_ID) {
      // Never echo the customer ID.
      throw ErrorMapper.local("invalid_customer_id", "customerId must be your own user ID as a string of 1-255 characters (never an email or phone number).", "customer_id");
    }
    long issued = issuedAt != null ? issuedAt : System.currentTimeMillis() / 1000L;
    if (issued < 0) {
      throw ErrorMapper.local("invalid_argument", "issuedAt must be whole Unix seconds.", "issued_at");
    }
    return sign(resolveSecret(secret, appId, ownSecret, ownSecrets, env), customerId, issued);
  }

  static String sign(String secret, String customerId, long issuedAt) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      byte[] digest = mac.doFinal((customerId + "." + issuedAt).getBytes(StandardCharsets.UTF_8));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(digest) + "." + issuedAt;
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("HmacSHA256 is unavailable", e);
    }
  }

  private static String resolveSecret(
      @Nullable String secret, @Nullable String appId, @Nullable String ownSecret, @Nullable Map<String, String> ownSecrets, Function<String, @Nullable String> env) {
    if (secret != null && !secret.isEmpty()) return secret;
    Map<String, String> secrets = ownSecrets != null ? ownSecrets : envMap(env.apply(SECRETS_ENV));
    if (appId != null && secrets != null) {
      String s = secrets.get(appId);
      if (s != null && !s.isEmpty()) return s;
    }
    String envSecret = env.apply(SECRET_ENV);
    String single = ownSecret != null && !ownSecret.isEmpty() ? ownSecret : (envSecret != null && !envSecret.isEmpty() ? envSecret : null);
    if (single != null) return single;
    if (appId == null && secrets != null && !secrets.isEmpty()) {
      throw new ConfigurationException("Several apps' identity secrets are set (" + SECRETS_ENV + "): pass the appId to choose one.", "missing_identity_secret", null, null, "appId", null, null);
    }
    String message = appId == null
        ? "No identity secret: set " + SECRET_ENV + " on your server (Apps > your app > Identity secret)."
        : "No identity secret for this app: add it to " + SECRETS_ENV + " or set " + SECRET_ENV + ".";
    throw new ConfigurationException(message, "missing_identity_secret", null, null, "secret", null, null);
  }

  static @Nullable Map<String, String> envMap(@Nullable String raw) {
    if (raw == null || raw.trim().isEmpty()) return null;
    Object parsed;
    try {
      parsed = Json.parse(raw);
    } catch (Exception e) {
      parsed = null;
    }
    Map<String, String> out = new LinkedHashMap<>();
    boolean ok = parsed instanceof Map;
    if (ok) {
      for (Map.Entry<?, ?> e : ((Map<?, ?>) parsed).entrySet()) {
        if (!(e.getKey() instanceof String) || !(e.getValue() instanceof String) || ((String) e.getValue()).isEmpty()) {
          ok = false;
          break;
        }
        out.put((String) e.getKey(), (String) e.getValue());
      }
    }
    if (!ok) {
      // Never echo the value: it holds secrets.
      throw new ConfigurationException(SECRETS_ENV + " must be a JSON object of app IDs to identity secrets, e.g. {\"app_…\": \"cgis_…\"}.", "invalid_identity_secrets", null, null, SECRETS_ENV, null, null);
    }
    return Collections.unmodifiableMap(out);
  }
}
