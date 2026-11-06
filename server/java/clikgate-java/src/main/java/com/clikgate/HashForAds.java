package com.clikgate;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.internal.ErrorMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Hashed email and phone for ad network matching (SPEC 25). Pure and offline: no client needed.
 *
 * <p>Normalise and hash a customer's email and / or phone on your own server, for a goal's {@code hashedEmail},
 * {@code hashedPhoneE164} and {@code hashedPhoneDigits}. They are used only if the business turned on matching by
 * hashed email or phone for a destination. In private mode, hash on your own server: Clikgate never hashes for you
 * there.
 *
 * <pre>{@code
 * clikgate.goal("account_opened", Goal.builder()
 *     .reference("APP-55231")
 *     .clickId(clickId)
 *     .hashed(HashForAds.hash(customer.getEmail(), customer.getPhone()))   // e.g. "+234 803 123 4567"
 *     .build());
 * }</pre>
 */
public final class HashForAds {
  private static final Pattern SHA256_HEX = Pattern.compile("[0-9a-f]{64}");
  private static final Pattern E164_DIGITS = Pattern.compile("[1-9][0-9]{6,14}");
  private static final Pattern NON_DIGIT = Pattern.compile("[^0-9]");
  private static final String[] FIELDS = {"hashed_email", "hashed_phone_e164", "hashed_phone_digits"};
  private static final char[] HEX = "0123456789abcdef".toCharArray();

  private HashForAds() {}

  /**
   * Hash an email and / or a phone. A null input gives no field (its getter is null).
   *
   * <ul>
   *   <li>email: trimmed and lowercased (locale-independent); it must contain {@code @}.
   *   <li>phone: must include its country code (start with {@code +} or {@code 00}); spaces and punctuation are
   *       removed and the result must be 7-15 digits starting with 1-9. A national number such as
   *       {@code 0803 123 4567} is refused: add the country code yourself, the SDK never guesses it.
   * </ul>
   *
   * @throws InvalidRequestException {@code invalid_argument} with param {@code email} or {@code phone}; the input is
   *     never in the message
   */
  public static HashedIdentifiers hash(@Nullable String email, @Nullable String phone) {
    String hashedEmail = null;
    String hashedE164 = null;
    String hashedDigits = null;
    if (email != null) {
      String value = trim(email).toLowerCase(Locale.ROOT);
      if (value.indexOf('@') < 0) {
        throw ErrorMapper.local("invalid_argument", "email must be an email address (it contains @).", "email");
      }
      hashedEmail = sha256(value);
    }
    if (phone != null) {
      String trimmed = trim(phone);
      String digits = NON_DIGIT.matcher(trimmed).replaceAll("");
      if (trimmed.startsWith("00")) {
        digits = digits.substring(2);
      } else if (!trimmed.startsWith("+")) {
        digits = "";
      }
      if (!E164_DIGITS.matcher(digits).matches()) {
        throw ErrorMapper.local(
            "invalid_argument", "phone must include its country code, e.g. \"+234 803 123 4567\" (7-15 digits after the +).", "phone");
      }
      hashedE164 = sha256("+" + digits);
      hashedDigits = sha256(digits);
    }
    return new HashedIdentifiers(hashedEmail, hashedE164, hashedDigits);
  }

  /** Refuse a hashed wire field that isn't 64 lowercase hex characters (the value is never echoed). */
  static void checkWire(Map<String, ?> wire) {
    for (String field : FIELDS) {
      Object v = wire.get(field);
      if (v == null) {
        continue;
      }
      if (!(v instanceof String) || !SHA256_HEX.matcher((String) v).matches()) {
        throw ErrorMapper.local(
            "invalid_hashed_identifier", field + " must be a SHA-256 hash as 64 lowercase hex characters (use HashForAds.hash).", field);
      }
    }
  }

  /** Trim Unicode whitespace (including no-break spaces and the BOM) at both ends. */
  private static String trim(String s) {
    int start = 0;
    int end = s.length();
    while (start < end && isSpace(s.charAt(start))) {
      start++;
    }
    while (end > start && isSpace(s.charAt(end - 1))) {
      end--;
    }
    return s.substring(start, end);
  }

  private static boolean isSpace(char c) {
    return Character.isWhitespace(c) || Character.isSpaceChar(c) || c == '﻿';
  }

  private static String sha256(String value) {
    MessageDigest md;
    try {
      md = MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is not available", e);
    }
    byte[] digest = md.digest(value.getBytes(StandardCharsets.UTF_8));
    char[] out = new char[digest.length * 2];
    for (int i = 0; i < digest.length; i++) {
      out[i * 2] = HEX[(digest[i] >> 4) & 0xf];
      out[i * 2 + 1] = HEX[digest[i] & 0xf];
    }
    return new String(out);
  }
}
