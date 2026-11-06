package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Requester;
import com.clikgate.model.Click;

/** Clicks. */
public final class Clicks {
  private final Core core;

  Clicks(Core core) {
    this.core = core;
  }

  /**
   * Fetch a click by its ID ({@code clk_…}).
   *
   * <pre>{@code
   * Click click = clikgate.clicks().get(clickId);
   * }</pre>
   */
  public Click get(String clickId) {
    return get(clickId, RequestOptions.NONE);
  }

  /** {@link #get(String)} with per-call options. */
  public Click get(String clickId, RequestOptions options) {
    String path = "/v1/clicks/" + Requester.encodePathSegment(Requester.requireId(clickId, "click_id"));
    return new Click(Links.asMap(core.requester.request(new ApiRequest("GET", path).options(options)).data));
  }
}
