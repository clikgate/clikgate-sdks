package com.clikgate;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * One existing customer for {@link KnownCustomers#importCustomers}: your customer ID and, optionally, the day they
 * became a customer (UTC).
 *
 * <pre>{@code
 * KnownCustomer.of("u_10482", LocalDate.of(2024, 3, 2));
 * }</pre>
 */
public final class KnownCustomer {
  final String customerId;
  final @Nullable LocalDate customerSince;

  private KnownCustomer(String customerId, @Nullable LocalDate customerSince) {
    this.customerId = Objects.requireNonNull(customerId, "customerId");
    this.customerSince = customerSince;
  }

  /** A customer without a date (the import date is used). */
  public static KnownCustomer of(String customerId) {
    return new KnownCustomer(customerId, null);
  }

  /** A customer since that day. */
  public static KnownCustomer of(String customerId, @Nullable LocalDate customerSince) {
    return new KnownCustomer(customerId, customerSince);
  }

  /** A customer since that moment (only its UTC day is sent). */
  public static KnownCustomer of(String customerId, @Nullable Instant customerSince) {
    return new KnownCustomer(customerId, customerSince == null ? null : customerSince.atZone(ZoneOffset.UTC).toLocalDate());
  }
}
