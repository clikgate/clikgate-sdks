package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Guard;
import com.clikgate.internal.Requester;
import com.clikgate.model.Conversion;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Conversions: the older API. New integrations should use goals. */
public final class Conversions {
  private final Core core;

  Conversions(Core core) {
    this.core = core;
  }

  /**
   * Report a conversion ({@code POST /v1/conversions}). {@code params} use the API's field names. In private mode
   * only {@code external_id}, {@code goal}, {@code click_id}, {@code code}, {@code reference}, {@code value},
   * {@code currency}, {@code provider}, {@code is_first}, {@code occurred_at}, {@code consent}, {@code kept_by},
   * {@code browser_engine}, {@code platform} and the hashed identifiers {@code hashed_email},
   * {@code hashed_phone_e164}, {@code hashed_phone_digits} (64 lowercase hex; {@link HashForAds#hash}) are allowed. A
   * hashed identifier that isn't 64 lowercase hex characters is refused locally ({@code invalid_hashed_identifier}).
   *
   * <p>With {@code goal} set to a Payment goal this is a trusted payment confirmation: send {@code provider} and the
   * payment reference ({@code external_id}); the answer is then the goal event ({@link Conversion#isGoalEvent()},
   * {@link Conversion#asGoalEvent()}).
   *
   * <pre>{@code
   * Map<String, Object> p = new HashMap<>();
   * p.put("external_id", "ORD-1001"); p.put("click_id", clickId); p.put("goal", "order_paid"); p.put("value", new BigDecimal("1500.50"));
   * clikgate.conversions().create(p);
   * }</pre>
   */
  public Conversion create(Map<String, ?> params) {
    return create(params, RequestOptions.NONE);
  }

  /** {@link #create(Map)} with per-call options. */
  public Conversion create(Map<String, ?> params, RequestOptions options) {
    Map<String, @Nullable Object> body = withValue(params);
    HashForAds.checkWire(body);
    if (core.guardState().guard) {
      Guard.check("conversion", body);
    }
    return new Conversion(Links.asMap(core.requester.request(new ApiRequest("POST", "/v1/conversions").body(body).options(options)).data));
  }

  /**
   * Reverse a conversion, fully or partly ({@code amount_minor}).
   *
   * <pre>{@code
   * clikgate.conversions().reverse("cnv_01J…", Collections.singletonMap("amount_minor", 200000));
   * }</pre>
   */
  public Conversion reverse(String id) {
    return reverse(id, Collections.<String, Object>emptyMap(), RequestOptions.NONE);
  }

  /** Reverse with {@code amount_minor}, {@code reason} or {@code external_id}. */
  public Conversion reverse(String id, Map<String, ?> params) {
    return reverse(id, params, RequestOptions.NONE);
  }

  /** {@link #reverse(String, Map)} with per-call options. */
  public Conversion reverse(String id, Map<String, ?> params, RequestOptions options) {
    Map<String, @Nullable Object> body = withValue(params);
    if (core.guardState().guard) {
      Guard.check("reversal", body);
    }
    String path = "/v1/conversions/" + Requester.encodePathSegment(Requester.requireId(id, "id")) + "/reverse";
    return new Conversion(Links.asMap(core.requester.request(new ApiRequest("POST", path).body(body).options(options)).data));
  }

  private static Map<String, @Nullable Object> withValue(Map<String, ?> params) {
    Map<String, @Nullable Object> out = new LinkedHashMap<>(params);
    Object v = out.get("value");
    if (v != null) {
      out.put("value", Money.formatObject(v));
    }
    return out;
  }
}
