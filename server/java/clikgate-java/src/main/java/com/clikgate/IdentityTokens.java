package com.clikgate;

import com.clikgate.exception.ClikgateServerOnlyException;
import com.clikgate.exception.ConfigurationException;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Json;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Instant;
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
 * Clikgate verifies with. With a {@code customerSince} the token is version 2 and also carries when the
 * person became your customer: {@code signature.issuedAt.customerSince}, so Clikgate can tell an existing customer from
 * a new one. No network call and no API key needed. Guide: https://clikgate.com/docs/identify-users
 *
 * <pre>{@code
 * String token = IdentityTokens.create(user.getId());             // CLIKGATE_IDENTITY_SECRET
 * String token = IdentityTokens.create(user.getId(), "app_…");    // that app's secret from CLIKGATE_IDENTITY_SECRETS
 * String token = IdentityTokens.create(user.getId(), null, user.getCreatedAt());   // version 2, with the account date
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
  /** 1990-01-01: earlier account dates are refused. */
  private static final long MIN_CUSTOMER_SINCE = 631_152_000L;
  /** The clock allowance for an account date after issuedAt. */
  private static final long CLOCK_ALLOWANCE = 300L;
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

  /**
   * A version 2 token carrying when the person became your customer, issued now, signed with
   * {@code appId}'s secret (or {@code CLIKGATE_IDENTITY_SECRET} when {@code appId} is null). A null
   * {@code customerSince} (no stored account date) makes a version 1 token, the same as
   * {@link #create(String, String)}, so one call works for every customer.
   */
  public static String create(String customerId, @Nullable String appId, @Nullable Instant customerSince) {
    if (customerSince == null) return create(customerId, appId);
    return createWith(onAndroid(), null, null, System::getenv, customerId, appId, null, null, customerSince.getEpochSecond());
  }

  /** A version 2 token signed with an explicit secret, issue time and account date (Unix seconds). */
  public static String create(String customerId, String secret, long issuedAtSeconds, long customerSinceSeconds) {
    return createWith(onAndroid(), null, null, System::getenv, customerId, null, secret, issuedAtSeconds, customerSinceSeconds);
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
    return createWith(android, ownSecret, ownSecrets, env, customerId, appId, secret, issuedAt, null);
  }

  static String createWith(
      boolean android,
      @Nullable String ownSecret,
      @Nullable Map<String, String> ownSecrets,
      Function<String, @Nullable String> env,
      @Nullable String customerId,
      @Nullable String appId,
      @Nullable String secret,
      @Nullable Long issuedAt,
      @Nullable Long customerSince) {
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
    if (customerSince == null) {
      return sign(resolveSecret(secret, appId, ownSecret, ownSecrets, env), customerId, issued);
    }
    if (customerSince < MIN_CUSTOMER_SINCE || customerSince > issued + CLOCK_ALLOWANCE) {
      throw ErrorMapper.local("invalid_argument", "customerSince must be between 1990 and the time the token is issued.", "customer_since");
    }
    String cid = CustomerIds.canonical(customerId);
    if (cid.isEmpty()) {
      throw ErrorMapper.local("invalid_customer_id", "customerId must be your own user ID as a string of 1-255 characters (never an email or phone number).", "customer_id");
    }
    return signV2(resolveSecret(secret, appId, ownSecret, ownSecrets, env), cid, issued, customerSince);
  }

  /**
   * Version 2: the MAC input is
   * {@code "v2\n" + utf8Length(cid) + ":" + cid + "\n" + issuedAt + "\n" + customerSince}, cid in canonical form.
   */
  static String signV2(String secret, String customerId, long issuedAt, long customerSince) {
    String cid = CustomerIds.canonical(customerId);
    String msg = "v2\n" + cid.getBytes(StandardCharsets.UTF_8).length + ":" + cid + "\n" + issuedAt + "\n" + customerSince;
    return mac(secret, msg) + "." + issuedAt + "." + customerSince;
  }

  private static String mac(String secret, String message) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("HmacSHA256 is unavailable", e);
    }
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
