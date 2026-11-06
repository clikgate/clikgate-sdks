package com.clikgate.http;

import java.io.IOException;

/**
 * Sends one HTTP attempt. Replace the built-in one ({@code Clikgate.builder().transport(...)}) to use your own
 * HTTP client (OkHttp, Apache HttpClient, a mTLS-configured client, …). Implementations MUST NOT follow redirects.
 *
 * <p>Throw {@link java.net.SocketTimeoutException} (or {@code ClikgateTimeoutException}) when the timeout elapses,
 * and any other {@link IOException} when the connection fails. Retries, errors and idempotency are the SDK's.
 *
 * <pre>{@code
 * Transport okhttp = request -> {
 *   Request r = new Request.Builder().url(request.getUrl()).method(request.getMethod(),
 *       request.getBody() == null ? null : RequestBody.create(request.getBody())).headers(Headers.of(request.getHeaders())).build();
 *   try (Response res = client.newBuilder().callTimeout(request.getTimeout()).build().newCall(r).execute()) {
 *     return new TransportResponse(res.code(), lowercase(res.headers().toMultimap()), res.body().bytes());
 *   }
 * };
 * }</pre>
 */
@FunctionalInterface
public interface Transport {
  TransportResponse send(TransportRequest request) throws IOException;
}
