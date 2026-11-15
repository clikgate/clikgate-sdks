package com.clikgate;

import com.clikgate.exception.ConflictException;
import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.model.KnownCustomersImportResult;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Known customers: people who were already your customers before you added Clikgate. Clikgate uses
 * them so an existing customer is never counted as a referral or a new customer. It stores a keyed fingerprint of each
 * ID, not the ID itself. Not available in private mode. Scope {@code people:write}.
 */
public final class KnownCustomers {
  /** The API's batch size; {@link #importCustomers} splits larger lists. */
  public static final int BATCH = 10_000;

  private final Core core;

  KnownCustomers(Core core) {
    this.core = core;
  }

  /**
   * Import existing customers ({@code POST /v1/known-customers/import}), in batches of 10,000. Idempotent per customer
   * ID. Use your own customer IDs, never emails or phone numbers. Refused rows are counted by reason, never returned.
   *
   * <pre>{@code
   * KnownCustomersImportResult r = clikgate.knownCustomers().importCustomers(List.of(KnownCustomer.of("u_10482", LocalDate.of(2024, 3, 2))));
   * }</pre>
   */
  public KnownCustomersImportResult importCustomers(List<KnownCustomer> customers) {
    return importCustomers(customers, RequestOptions.NONE);
  }

  /** {@link #importCustomers(List)} with per-call options. A given idempotency key gets {@code -<batch>} appended when there are several batches. */
  public KnownCustomersImportResult importCustomers(List<KnownCustomer> customers, RequestOptions options) {
    List<Map<String, Object>> rows = new ArrayList<>(customers.size());
    for (KnownCustomer c : customers) {
      if (c == null) throw ErrorMapper.local("invalid_argument", "customers must not contain null.", "customer_id");
      Map<String, Object> row = new LinkedHashMap<>();
      row.put("customer_id", c.customerId);
      if (c.customerSince != null) row.put("customer_since", c.customerSince.toString());
      rows.add(row);
    }
    long accepted = 0;
    long refused = 0;
    Map<String, Long> reasons = new LinkedHashMap<>();
    if (rows.isEmpty()) return new KnownCustomersImportResult(0, 0, reasons);
    if (core.guardState().guard) throw privateModeConflict();
    boolean several = rows.size() > BATCH;
    for (int i = 0, n = 0; i < rows.size(); i += BATCH, n++) {
      Map<String, Object> body = new LinkedHashMap<>();
      body.put("customers", rows.subList(i, Math.min(i + BATCH, rows.size())));
      ApiRequest request = new ApiRequest("POST", "/v1/known-customers/import").body(body).options(options);
      if (several && options.getIdempotencyKey() != null) request.idempotencyKey(options.getIdempotencyKey() + "-" + n);
      Map<String, ?> data = Links.asMap(core.requester.request(request).data);
      if (data == null) continue;
      accepted += number(data.get("accepted"));
      refused += number(data.get("refused"));
      Object byReason = data.get("refused_by_reason");
      if (byReason instanceof Map) {
        for (Map.Entry<?, ?> e : ((Map<?, ?>) byReason).entrySet()) {
          reasons.merge(String.valueOf(e.getKey()), number(e.getValue()), Long::sum);
        }
      }
    }
    return new KnownCustomersImportResult(accepted, refused, reasons);
  }

  /**
   * Remove one imported customer ({@code POST /v1/known-customers/remove}; the ID travels in the body, never in a URL).
   * True when a customer was removed.
   */
  public boolean remove(String customerId) {
    return remove(customerId, RequestOptions.NONE);
  }

  /** {@link #remove(String)} with per-call options. */
  public boolean remove(String customerId, RequestOptions options) {
    if (customerId == null || customerId.isEmpty()) {
      throw ErrorMapper.local("invalid_customer_id", "customerId must be a non-empty string.", "customer_id");
    }
    if (core.guardState().guard) throw privateModeConflict();
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("customer_id", customerId);
    Map<String, ?> data = Links.asMap(core.requester.request(new ApiRequest("POST", "/v1/known-customers/remove").body(body).options(options)).data);
    return data != null && Boolean.TRUE.equals(data.get("removed"));
  }

  private static long number(Object v) {
    return v instanceof Number ? ((Number) v).longValue() : 0L;
  }

  private static ConflictException privateModeConflict() {
    return new ConflictException("Private mode is on: known customers can't be imported or removed.", "private_mode_conflict");
  }
}
