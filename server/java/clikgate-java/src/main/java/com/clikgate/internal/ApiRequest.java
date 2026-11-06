package com.clikgate.internal;

import com.clikgate.http.RequestOptions;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Internal: a request as the resources (and the generated layer) describe it. */
public final class ApiRequest {
  final String method;
  final String path;
  final Map<String, ?> query;
  boolean hasBody;
  @Nullable Object body;
  @Nullable String idempotencyKey;
  @Nullable Duration timeout;
  @Nullable Integer maxRetries;

  public ApiRequest(String method, String path) {
    this(method, path, Collections.<String, Object>emptyMap());
  }

  public ApiRequest(String method, String path, Map<String, ?> query) {
    this.method = method;
    this.path = path;
    this.query = new LinkedHashMap<>(query);
  }

  public ApiRequest body(@Nullable Object body) {
    this.hasBody = true;
    this.body = body;
    return this;
  }

  public ApiRequest idempotencyKey(String key) {
    this.idempotencyKey = key;
    return this;
  }

  public ApiRequest timeout(Duration timeout) {
    this.timeout = timeout;
    return this;
  }

  public ApiRequest maxRetries(int maxRetries) {
    this.maxRetries = maxRetries;
    return this;
  }

  public ApiRequest options(@Nullable RequestOptions options) {
    if (options != null) {
      if (options.getIdempotencyKey() != null) {
        this.idempotencyKey = options.getIdempotencyKey();
      }
      if (options.getTimeout() != null) {
        this.timeout = options.getTimeout();
      }
      if (options.getMaxRetries() != null) {
        this.maxRetries = options.getMaxRetries();
      }
    }
    return this;
  }
}
