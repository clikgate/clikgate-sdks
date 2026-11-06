package com.clikgate.exception;

import java.util.Collections;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Base class of every exception the SDK throws (SPEC section 5). Unchecked, so it reads well from Kotlin.
 *
 * <pre>{@code
 * try {
 *   clikgate.goals().send("account_opened", Goal.builder().reference("APP-55231").value(2_000_000L).build());
 * } catch (RateLimitException e) {
 *   System.out.println("retry in " + e.getRetryAfter() + " s");
 * } catch (InvalidRequestException e) {
 *   System.out.println(e.getCode() + " " + e.getParam());
 * }
 * }</pre>
 */
public class ClikgateException extends RuntimeException {
  private static final long serialVersionUID = 1L;

  private final String code;
  private final @Nullable Integer httpStatus;
  private final @Nullable String requestId;
  private final @Nullable String param;
  private final @Nullable String type;
  private final transient @Nullable Map<String, Object> raw;

  public ClikgateException(String message, String code, @Nullable Integer httpStatus, @Nullable String requestId, @Nullable String param, @Nullable String type, @Nullable Map<String, Object> raw) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.requestId = requestId;
    this.param = param;
    this.type = type;
    this.raw = raw == null ? null : Collections.unmodifiableMap(raw);
  }

  public ClikgateException(String message, String code) {
    this(message, code, null, null, null, null, null);
  }

  /** Stable machine-readable code, e.g. {@code invalid_value}, {@code link_locked}, {@code network_error}. */
  public String getCode() {
    return code;
  }

  /** The HTTP status, or null for local, network and timeout errors. */
  public @Nullable Integer getHttpStatus() {
    return httpStatus;
  }

  /** The request ID ({@code req_…}) to quote to Clikgate support, when the API answered. */
  public @Nullable String getRequestId() {
    return requestId;
  }

  /** The request field the error is about, when there is one. */
  public @Nullable String getParam() {
    return param;
  }

  /** The envelope {@code type} ({@code invalid_request}, {@code conflict}, …), or null for local errors. */
  public @Nullable String getType() {
    return type;
  }

  /** The raw {@code error} object from the API, including extra keys such as {@code required_plan}. */
  public @Nullable Map<String, Object> getRaw() {
    return raw;
  }

  /** @return a value of {@link #getRaw()}, or null */
  protected @Nullable Object rawValue(String key) {
    return raw == null ? null : raw.get(key);
  }
}
