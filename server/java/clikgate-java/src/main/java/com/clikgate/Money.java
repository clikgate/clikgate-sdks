package com.clikgate;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.internal.ErrorMapper;
import java.math.BigDecimal;
import java.util.regex.Pattern;

/**
 * Money (SPEC section 8): {@code value} is in normal units (₦2,000,000 is {@code 2000000}, never kobo) and always
 * goes on the wire as a decimal string. There are deliberately no {@code double}/{@code float} overloads.
 */
public final class Money {
  private static final Pattern DECIMAL = Pattern.compile("[0-9]+(\\.[0-9]+)?");

  private Money() {}

  /**
   * A {@link BigDecimal} in plain notation with its scale kept: {@code new BigDecimal("1500.50")} → {@code "1500.50"},
   * {@code new BigDecimal("1E+3")} → {@code "1000"}.
   *
   * <pre>{@code
   * Money.formatValue(new BigDecimal("2000000")); // "2000000"
   * }</pre>
   *
   * @throws InvalidRequestException {@code invalid_value} for negative values
   */
  public static String formatValue(BigDecimal value) {
    if (value.signum() < 0) {
      throw bad("must not be negative");
    }
    return value.signum() == 0 && value.scale() <= 0 ? "0" : value.toPlainString();
  }

  /**
   * An integer amount as its digits.
   *
   * <pre>{@code
   * Money.formatValue(2_000_000L); // "2000000"
   * }</pre>
   */
  public static String formatValue(long value) {
    if (value < 0) {
      throw bad("must not be negative");
    }
    return Long.toString(value);
  }

  /**
   * A decimal string, trimmed; it must look like {@code 2000000} or {@code 1500.50} (no signs, exponents or
   * separators) and is sent as given.
   *
   * <pre>{@code
   * Money.formatValue("1500.50"); // "1500.50"
   * }</pre>
   */
  public static String formatValue(String value) {
    String s = value.trim();
    if (!DECIMAL.matcher(s).matches()) {
      throw bad("must be a non-negative decimal number");
    }
    return s;
  }

  static String formatObject(Object value) {
    if (value instanceof BigDecimal) {
      return formatValue((BigDecimal) value);
    }
    if (value instanceof Long || value instanceof Integer || value instanceof Short || value instanceof Byte) {
      return formatValue(((Number) value).longValue());
    }
    if (value instanceof java.math.BigInteger) {
      if (((java.math.BigInteger) value).signum() < 0) {
        throw bad("must not be negative");
      }
      return value.toString();
    }
    if (value instanceof String) {
      return formatValue((String) value);
    }
    throw new IllegalArgumentException("value must be a BigDecimal, long or decimal String, not " + value.getClass().getSimpleName() + ": floating-point types can't hold exact amounts.");
  }

  private static InvalidRequestException bad(String why) {
    return ErrorMapper.local("invalid_value", "value " + why + ". Pass a decimal in normal units, like new BigDecimal(\"1500.50\").", "value");
  }
}
