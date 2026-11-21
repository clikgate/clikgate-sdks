package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Requester;
import com.clikgate.model.PrivacyRequest;

/** Privacy requests: access, export, delete or erasure of one data subject's data. */
public final class Privacy {
  private final Core core;

  Privacy(Core core) {
    this.core = core;
  }

  /**
   * Start a privacy request. It runs in the background: follow it with {@link #getRequest(String)} or the
   * {@code privacy.request_completed} webhook.
   *
   * <pre>{@code
   * PrivacyRequest req = clikgate.privacy().createRequest(
   *     CreatePrivacyRequestParams.builder().type("erasure").subjectType("customer_user").subjectId(user.getId()).build());
   * }</pre>
   */
  public PrivacyRequest createRequest(CreatePrivacyRequestParams params) {
    return createRequest(params, RequestOptions.NONE);
  }

  /** {@link #createRequest(CreatePrivacyRequestParams)} with per-call options. */
  public PrivacyRequest createRequest(CreatePrivacyRequestParams params, RequestOptions options) {
    return new PrivacyRequest(Links.asMap(core.requester.request(new ApiRequest("POST", "/v1/privacy/requests").body(params.wire()).options(options)).data));
  }

  /**
   * A privacy request by ID.
   *
   * <pre>{@code
   * PrivacyRequest req = clikgate.privacy().getRequest("prq_01J…");
   * }</pre>
   */
  public PrivacyRequest getRequest(String id) {
    return getRequest(id, RequestOptions.NONE);
  }

  /** {@link #getRequest(String)} with per-call options. */
  public PrivacyRequest getRequest(String id, RequestOptions options) {
    String path = "/v1/privacy/requests/" + Requester.encodePathSegment(Requester.requireId(id, "id"));
    return new PrivacyRequest(Links.asMap(core.requester.request(new ApiRequest("GET", path).options(options)).data));
  }
}
