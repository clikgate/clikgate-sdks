package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Requester;
import com.clikgate.model.Install;
import java.util.Collections;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** App installs: find a customer's install, or an installation's. */
public final class Installs {
  private final Core core;

  Installs(Core core) {
    this.core = core;
  }

  private Install get(String path, @Nullable String appId, RequestOptions options) {
    Map<String, Object> query = appId == null ? Collections.<String, Object>emptyMap() : Collections.<String, Object>singletonMap("app_id", appId);
    return new Install(Links.asMap(core.requester.request(new ApiRequest("GET", path, query).options(options)).data));
  }

  /**
   * The latest install of your user with this ID.
   *
   * <pre>{@code
   * Install install = clikgate.installs().getByCustomer(user.getId());
   * }</pre>
   */
  public Install getByCustomer(String customerId) {
    return getByCustomer(customerId, null, RequestOptions.NONE);
  }

  /** {@link #getByCustomer(String)} in one app. */
  public Install getByCustomer(String customerId, @Nullable String appId) {
    return getByCustomer(customerId, appId, RequestOptions.NONE);
  }

  /** {@link #getByCustomer(String, String)} with per-call options. */
  public Install getByCustomer(String customerId, @Nullable String appId, RequestOptions options) {
    String path = "/v1/installs/by-customer-user/" + Requester.encodePathSegment(Requester.requireId(customerId, "customer_id"));
    return get(path, appId, options);
  }

  /**
   * The install of the mobile SDK's installation ID (from the {@code Clikgate-Installation} header).
   *
   * <pre>{@code
   * Install install = clikgate.installs().getByInstallation(installation.getInstallationId(), installation.getAppId());
   * }</pre>
   */
  public Install getByInstallation(String installationId) {
    return getByInstallation(installationId, null, RequestOptions.NONE);
  }

  /** {@link #getByInstallation(String)} in one app (needed when the ID is in several of your apps). */
  public Install getByInstallation(String installationId, @Nullable String appId) {
    return getByInstallation(installationId, appId, RequestOptions.NONE);
  }

  /** {@link #getByInstallation(String, String)} with per-call options. */
  public Install getByInstallation(String installationId, @Nullable String appId, RequestOptions options) {
    String path = "/v1/installs/by-installation/" + Requester.encodePathSegment(Requester.requireId(installationId, "installation_id"));
    return get(path, appId, options);
  }
}
