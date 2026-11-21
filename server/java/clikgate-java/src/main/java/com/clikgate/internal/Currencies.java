package com.clikgate.internal;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Internal: ISO 4217 minor-unit exponents, to turn an amount in minor units into normal units. */
public final class Currencies {
  private static final Map<String, Integer> NOT_TWO = new HashMap<>();

  static {
    for (String c : new String[] {"BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF"}) {
      NOT_TWO.put(c, 0);
    }
    for (String c : new String[] {"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"}) {
      NOT_TWO.put(c, 3);
    }
    NOT_TWO.put("CLF", 4);
    NOT_TWO.put("UYW", 4);
  }

  private Currencies() {}

  /** The currency's exponent (decimal places); 2 for a code this table doesn't list. */
  public static int exponent(String currency) {
    Integer e = NOT_TWO.get(currency.toUpperCase(Locale.ROOT));
    return e == null ? 2 : e.intValue();
  }

  /** {@code amountMinor} in normal units (exact), or null when either is missing. */
  public static @Nullable BigDecimal toNormalUnits(@Nullable Long amountMinor, @Nullable String currency) {
    if (amountMinor == null || currency == null || currency.isEmpty()) {
      return null;
    }
    return BigDecimal.valueOf(amountMinor.longValue()).movePointLeft(exponent(currency));
  }
}
