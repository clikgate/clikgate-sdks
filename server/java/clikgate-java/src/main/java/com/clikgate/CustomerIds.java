package com.clikgate;

import java.text.Normalizer;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Your customer IDs in one canonical form (change 26 KC.1, R.24), the form the API stores and checks: Unicode NFC,
 * trimmed of Unicode whitespace (and U+FEFF) at both ends, case kept.
 *
 * <p>Warnings (first match wins): {@code empty}, {@code too_long} (more than 128 characters),
 * {@code looks_like_email}, {@code looks_like_national_id} (exactly 11 digits, unless {@code allow11DigitIds}),
 * {@code looks_like_phone}. Use your own stable user ID (for example {@code u_10482}), never an email, phone number,
 * BVN or NIN.
 *
 * <pre>{@code
 * CustomerIds.warning("ada@example.com"); // "looks_like_email"
 * }</pre>
 */
public final class CustomerIds {
  /** The longest customer ID kept as a known customer, in Unicode code points. */
  public static final int MAX_LENGTH = 128;

  /** Unicode White_Space characters plus U+FEFF (the byte-order mark). */
  private static final String TRIM =
      "\t\n\u000b\u000c\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
  private static final Pattern NATIONAL_ID = Pattern.compile("[0-9]{11}");
  private static final Pattern PHONE = Pattern.compile("\\+?[0-9]{10,15}");

  private CustomerIds() {}

  /** The canonical form of a customer ID: NFC, trimmed, case kept. */
  public static String canonical(String customerId) {
    String s = Normalizer.normalize(customerId, Normalizer.Form.NFC);
    int start = 0;
    int end = s.length();
    while (start < end && TRIM.indexOf(s.charAt(start)) >= 0) start++;
    while (end > start && TRIM.indexOf(s.charAt(end - 1)) >= 0) end--;
    return s.substring(start, end);
  }

  /** Why Clikgate wouldn't keep this ID as a known customer, or null when it's fine. */
  public static @Nullable String warning(String customerId) {
    return warning(customerId, false);
  }

  /** {@link #warning(String)}, with "My IDs are 11-digit numbers" on or off. */
  public static @Nullable String warning(String customerId, boolean allow11DigitIds) {
    String cid = canonical(customerId);
    if (cid.isEmpty()) return "empty";
    if (cid.codePointCount(0, cid.length()) > MAX_LENGTH) return "too_long";
    int at = cid.indexOf('@');
    if (at >= 0 && cid.indexOf('.', at + 1) >= 0) return "looks_like_email";
    if (NATIONAL_ID.matcher(cid).matches()) return allow11DigitIds ? null : "looks_like_national_id";
    if (PHONE.matcher(cid.replace(" ", "").replace("-", "")).matches()) return "looks_like_phone";
    return null;
  }
}
