package com.clikgate;

import com.clikgate.exception.SignatureVerificationException;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Json;
import com.clikgate.model.WebhookEvent;
import java.nio.charset.StandardCharsets;
import java.security.InvalidKeyException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.jspecify.annotations.Nullable;

/**
 * Webhook verification (the {@code Clikgate-Signature} header). No API key or client needed: {@code Webhooks.verify(...)}.
 *
 * <p>{@code Clikgate-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]} with
 * {@code hex = HMAC-SHA256(key = the whole secret including "whsec_", message = "<t>." + raw body)}.
 */
public final class Webhooks {
  /** The default tolerance, in seconds. */
  public static final long DEFAULT_TOLERANCE = 300;
  private static final Pattern DIGITS = Pattern.compile("[0-9]+");

  private Webhooks() {}

  /**
   * Verify a delivery over the raw body bytes and return the parsed event. Throws {@link SignatureVerificationException}.
   *
   * <pre>{@code
   * WebhookEvent event = Webhooks.verify(rawBody, request.getHeader("Clikgate-Signature"), System.getenv("CLIKGATE_WEBHOOK_SECRET"));
   * if ("goal.completed".equals(event.getType())) { … }   // dedupe on event.getId(): delivery is at-least-once
   * }</pre>
   */
  public static WebhookEvent verify(byte[] rawBody, @Nullable String signatureHeader, String secret) {
    return verify(rawBody, signatureHeader, secret, DEFAULT_TOLERANCE, System.currentTimeMillis() / 1000);
  }

  /** {@link #verify(byte[], String, String)} over a String body (encoded as UTF-8). */
  public static WebhookEvent verify(String rawBody, @Nullable String signatureHeader, String secret) {
    return verify(rawBody.getBytes(StandardCharsets.UTF_8), signatureHeader, secret);
  }

  /** With a tolerance in seconds (0 disables the time check: tests only) and the current unix time. */
  public static WebhookEvent verify(byte[] rawBody, @Nullable String signatureHeader, String secret, long tolerance, long nowSeconds) {
    if (secret.isEmpty()) {
      throw ErrorMapper.local("invalid_argument", "secret must be the endpoint secret (whsec_…).", "secret");
    }
    return check(rawBody, signatureHeader, Collections.singletonList(secret), tolerance, nowSeconds);
  }

  /**
   * Like verify, accepting any of several secrets (while you rotate your own).
   *
   * <pre>{@code
   * WebhookEvent event = Webhooks.verifyAny(rawBody, header, Arrays.asList(newSecret, oldSecret));
   * }</pre>
   */
  public static WebhookEvent verifyAny(byte[] rawBody, @Nullable String signatureHeader, List<String> secrets) {
    return verifyAny(rawBody, signatureHeader, secrets, DEFAULT_TOLERANCE, System.currentTimeMillis() / 1000);
  }

  /** {@link #verifyAny(byte[], String, List)} with a tolerance and the current unix time. */
  public static WebhookEvent verifyAny(byte[] rawBody, @Nullable String signatureHeader, List<String> secrets, long tolerance, long nowSeconds) {
    if (secrets.isEmpty() || secrets.contains("")) {
      throw ErrorMapper.local("invalid_argument", "secrets must be a non-empty list of endpoint secrets.", "secrets");
    }
    return check(rawBody, signatureHeader, secrets, tolerance, nowSeconds);
  }

  private static WebhookEvent check(byte[] body, @Nullable String header, List<String> secrets, long tolerance, long now) {
    if (header == null || header.trim().isEmpty()) {
      throw fail("missing_signature", "The Clikgate-Signature header is missing.");
    }
    Long t = null;
    boolean bad = false;
    List<String> v1 = new ArrayList<>();
    for (String part : header.split(",")) {
      String p = part.trim();
      int eq = p.indexOf('=');
      if (eq < 0) {
        continue;
      }
      String key = p.substring(0, eq).trim();
      String value = p.substring(eq + 1).trim();
      if ("t".equals(key)) {
        if (DIGITS.matcher(value).matches() && value.length() < 19) {
          t = Long.parseLong(value);
        } else {
          bad = true;
        }
      } else if ("v1".equals(key)) {
        v1.add(value);
      }
    }
    if (bad || t == null || v1.isEmpty()) {
      throw fail("malformed_signature", "The Clikgate-Signature header is malformed (expected t=<unix seconds>,v1=<hex>).");
    }
    if (tolerance > 0 && Math.abs(now - t) > tolerance) {
      throw fail("timestamp_outside_tolerance", "The signature timestamp is more than " + tolerance + " s from now; the request may be a replay, or this server's clock is wrong.");
    }
    boolean matched = false;
    for (String secret : secrets) {
      byte[] expected = hex(hmac(secret, t, body)).getBytes(StandardCharsets.US_ASCII);
      for (String candidate : v1) {
        byte[] c = candidate.getBytes(StandardCharsets.UTF_8);
        if (c.length == expected.length && MessageDigest.isEqual(expected, c)) {
          matched = true;
        }
      }
    }
    if (!matched) {
      throw fail("no_matching_signature", "No signature matches: check the endpoint secret, and that you pass the raw body.");
    }
    Object event;
    try {
      event = Json.parse(body);
    } catch (Exception e) {
      throw fail("invalid_payload", "The body is not JSON.");
    }
    if (!(event instanceof Map)) {
      throw fail("invalid_payload", "The body is not an event object.");
    }
    @SuppressWarnings("unchecked")
    Map<String, ?> m = (Map<String, ?>) event;
    return new WebhookEvent(m);
  }

  private static byte[] hmac(String secret, long t, byte[] body) {
    try {
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      mac.update((t + ".").getBytes(StandardCharsets.UTF_8));
      return mac.doFinal(body);
    } catch (NoSuchAlgorithmException | InvalidKeyException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String hex(byte[] d) {
    StringBuilder sb = new StringBuilder(d.length * 2);
    for (byte b : d) {
      sb.append(Character.forDigit((b >> 4) & 0xf, 16)).append(Character.forDigit(b & 0xf, 16));
    }
    return sb.toString();
  }

  private static SignatureVerificationException fail(String code, String message) {
    return new SignatureVerificationException(message, code);
  }
}
