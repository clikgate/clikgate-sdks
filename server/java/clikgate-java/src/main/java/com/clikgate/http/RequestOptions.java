package com.clikgate.http;

import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * Per-call options accepted by every API method.
 *
 * <pre>{@code
 * clikgate.links().create(params, RequestOptions.builder().idempotencyKey("my-key").timeout(Duration.ofSeconds(30)).build());
 * }</pre>
 */
public final class RequestOptions {
  /** No overrides. */
  public static final RequestOptions NONE = new RequestOptions(null, null, null);

  private final @Nullable String idempotencyKey;
  private final @Nullable Duration timeout;
  private final @Nullable Integer maxRetries;

  private RequestOptions(@Nullable String idempotencyKey, @Nullable Duration timeout, @Nullable Integer maxRetries) {
    this.idempotencyKey = idempotencyKey;
    this.timeout = timeout;
    this.maxRetries = maxRetries;
  }

  public static Builder builder() {
    return new Builder();
  }

  /** Override the {@code Idempotency-Key} (POST and PATCH only). */
  public @Nullable String getIdempotencyKey() {
    return idempotencyKey;
  }

  /** Override the client's per-attempt timeout. */
  public @Nullable Duration getTimeout() {
    return timeout;
  }

  /** Override the client's {@code maxRetries}. */
  public @Nullable Integer getMaxRetries() {
    return maxRetries;
  }

  /** Builder for {@link RequestOptions}. */
  public static final class Builder {
    private @Nullable String idempotencyKey;
    private @Nullable Duration timeout;
    private @Nullable Integer maxRetries;

    private Builder() {}

    public Builder idempotencyKey(String key) {
      this.idempotencyKey = key;
      return this;
    }

    public Builder timeout(Duration timeout) {
      this.timeout = timeout;
      return this;
    }

    public Builder maxRetries(int maxRetries) {
      this.maxRetries = maxRetries;
      return this;
    }

    public RequestOptions build() {
      return new RequestOptions(idempotencyKey, timeout, maxRetries);
    }
  }
}
