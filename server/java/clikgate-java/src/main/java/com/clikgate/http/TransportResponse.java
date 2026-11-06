package com.clikgate.http;

import java.util.Collections;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import org.jspecify.annotations.Nullable;

/** The raw answer of one attempt. Header names are matched case-insensitively. */
public final class TransportResponse {
  private final int status;
  private final Map<String, String> headers;
  private final byte[] body;

  /**
   * @param headers response headers; repeated headers joined with {@code ", "}
   */
  public TransportResponse(int status, Map<String, String> headers, byte[] body) {
    this.status = status;
    TreeMap<String, String> h = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
    h.putAll(headers);
    this.headers = Collections.unmodifiableMap(h);
    this.body = body;
  }

  public int getStatus() {
    return status;
  }

  public Map<String, String> getHeaders() {
    return headers;
  }

  public @Nullable String header(String name) {
    return headers.get(name.toLowerCase(Locale.ROOT));
  }

  public byte[] getBody() {
    return body;
  }
}
