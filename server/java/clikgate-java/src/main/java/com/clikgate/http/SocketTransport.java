package com.clikgate.http;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Base64;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import org.jspecify.annotations.Nullable;

/**
 * The built-in transport: a small HTTP/1.1 client over sockets, so it works the same on Java 8 to 27 (Java 8's
 * {@code HttpURLConnection} can't send PATCH, and its proxy tunnelling drops {@code Proxy-Authorization}).
 *
 * <ul>
 *   <li>TLS with the JVM's trust store and hostname verification (SNI included);
 *   <li>one deadline per attempt covering connect, TLS, send and receive;
 *   <li>a proxy from {@code Clikgate.builder().proxy("http://user:pass@host:port")}, or the JVM's
 *       {@code https.proxyHost}/{@code https.proxyPort}/{@code http.nonProxyHosts}; HTTPS goes through a
 *       {@code CONNECT} tunnel and credentials are sent as {@code Proxy-Authorization: Basic …} (never logged);
 *   <li>keep-alive connections (a few idle ones per host, closed after 30 s);
 *   <li>redirects are never followed.
 * </ul>
 */
public final class SocketTransport implements Transport {
  private static final long IDLE_MS = 30_000;
  private static final int MAX_IDLE_PER_HOST = 4;
  private static final int MAX_HEADER_BYTES = 64 * 1024;

  private final @Nullable URI proxy;
  private final boolean systemProxy;
  private final SSLSocketFactory tls;
  private final Map<String, Deque<Conn>> idle = new HashMap<>();

  private SocketTransport(@Nullable URI proxy, boolean systemProxy, SSLSocketFactory tls) {
    this.proxy = proxy;
    this.systemProxy = systemProxy;
    this.tls = tls;
  }

  /** Use the JVM's proxy settings ({@code https.proxyHost}, {@code http.nonProxyHosts}). */
  public static SocketTransport systemDefault() {
    return new SocketTransport(null, true, (SSLSocketFactory) SSLSocketFactory.getDefault());
  }

  /** Always use this proxy ({@code http://[user:pass@]host:port} or {@code https://…}). */
  public static SocketTransport withProxy(URI proxy) {
    return new SocketTransport(proxy, false, (SSLSocketFactory) SSLSocketFactory.getDefault());
  }

  /** Never use a proxy, whatever the JVM settings say. */
  public static SocketTransport noProxy() {
    return new SocketTransport(null, false, (SSLSocketFactory) SSLSocketFactory.getDefault());
  }

  /** The same proxy behaviour with your own TLS settings (a client certificate for mTLS, a corporate CA). */
  public SocketTransport withSslSocketFactory(SSLSocketFactory factory) {
    return new SocketTransport(proxy, systemProxy, factory);
  }

  private static final class Conn {
    final Socket socket;
    final InputStream in;
    final OutputStream out;
    long idleSince;

    Conn(Socket socket) throws IOException {
      this.socket = socket;
      this.in = new BufferedInputStream(socket.getInputStream());
      this.out = socket.getOutputStream();
    }

    void close() {
      try {
        socket.close();
      } catch (IOException ignored) {
        // closing
      }
    }
  }

  @Override
  public TransportResponse send(TransportRequest request) throws IOException {
    URI uri = URI.create(request.getUrl());
    boolean https = "https".equalsIgnoreCase(uri.getScheme());
    String host = uri.getHost();
    if (host == null) {
      throw new IOException("The URL has no host.");
    }
    String bareHost = host.startsWith("[") && host.endsWith("]") ? host.substring(1, host.length() - 1) : host;
    int port = uri.getPort() > 0 ? uri.getPort() : (https ? 443 : 80);
    long deadline = System.nanoTime() + Math.max(1, request.getTimeout().toNanos());
    @Nullable URI viaProxy = proxyFor(https, bareHost);
    String key = (https ? "https://" : "http://") + host + ":" + port + (viaProxy == null ? "" : " via " + viaProxy);

    Conn pooled = takeIdle(key);
    if (pooled != null) {
      try {
        return exchange(pooled, key, request, uri, host, port, https, viaProxy, deadline);
      } catch (SocketTimeoutException e) {
        throw e;
      } catch (IOException stale) {
        pooled.close(); // the server closed an idle connection: try once on a fresh one
      }
    }
    Conn fresh = open(bareHost, port, https, viaProxy, deadline);
    return exchange(fresh, key, request, uri, host, port, https, viaProxy, deadline);
  }

  private TransportResponse exchange(Conn c, String key, TransportRequest request, URI uri, String host, int port, boolean https, @Nullable URI viaProxy, long deadline)
      throws IOException {
    boolean reusable = false;
    try {
      StringBuilder head = new StringBuilder();
      String target = uri.getRawPath() == null || uri.getRawPath().isEmpty() ? "/" : uri.getRawPath();
      if (uri.getRawQuery() != null) {
        target += "?" + uri.getRawQuery();
      }
      if (viaProxy != null && !https) {
        target = uri.getScheme() + "://" + host + ":" + port + target; // absolute form through an HTTP proxy
      }
      head.append(request.getMethod()).append(' ').append(target).append(" HTTP/1.1\r\n");
      boolean defaultPort = port == (https ? 443 : 80);
      head.append("Host: ").append(host).append(defaultPort ? "" : ":" + port).append("\r\n");
      for (Map.Entry<String, String> h : request.getHeaders().entrySet()) {
        head.append(h.getKey()).append(": ").append(h.getValue()).append("\r\n");
      }
      if (viaProxy != null && !https) {
        String auth = proxyAuthorization(viaProxy);
        if (auth != null) {
          head.append("Proxy-Authorization: ").append(auth).append("\r\n");
        }
      }
      byte[] body = request.getBody();
      if (body != null || "POST".equals(request.getMethod()) || "PATCH".equals(request.getMethod()) || "PUT".equals(request.getMethod())) {
        head.append("Content-Length: ").append(body == null ? 0 : body.length).append("\r\n");
      }
      head.append("Accept-Encoding: identity\r\n\r\n");
      setTimeout(c.socket, deadline);
      c.out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
      if (body != null) {
        c.out.write(body);
      }
      c.out.flush();

      setTimeout(c.socket, deadline);
      int status;
      Map<String, String> headers;
      do { // skip 1xx interim responses
        String statusLine = readLine(c.in);
        status = parseStatus(statusLine);
        headers = readHeaders(c.in);
      } while (status >= 100 && status < 200);

      byte[] responseBody;
      boolean bodyEnded;
      String te = headers.get("transfer-encoding");
      String cl = headers.get("content-length");
      if ("HEAD".equals(request.getMethod()) || status == 204 || status == 304) {
        responseBody = new byte[0];
        bodyEnded = true;
      } else if (te != null && te.toLowerCase(Locale.ROOT).contains("chunked")) {
        responseBody = readChunked(c, deadline);
        bodyEnded = true;
      } else if (cl != null) {
        responseBody = readFully(c, Long.parseLong(cl.trim()), deadline);
        bodyEnded = true;
      } else {
        responseBody = readToEof(c, deadline);
        bodyEnded = false;
      }
      String connection = headers.get("connection");
      reusable = bodyEnded && (connection == null || !connection.toLowerCase(Locale.ROOT).contains("close"));
      return new TransportResponse(status, headers, responseBody);
    } catch (NumberFormatException e) {
      throw new IOException("Malformed HTTP response.", e);
    } finally {
      if (reusable) {
        giveBack(key, c);
      } else {
        c.close();
      }
    }
  }

  private Conn open(String host, int port, boolean https, @Nullable URI viaProxy, long deadline) throws IOException {
    Socket raw = new Socket();
    try {
      raw.setTcpNoDelay(true);
      if (viaProxy == null) {
        raw.connect(new InetSocketAddress(host, port), remainingMillis(deadline));
      } else {
        int proxyPort = viaProxy.getPort() > 0 ? viaProxy.getPort() : ("https".equalsIgnoreCase(viaProxy.getScheme()) ? 443 : 80);
        raw.connect(new InetSocketAddress(viaProxy.getHost(), proxyPort), remainingMillis(deadline));
        if ("https".equalsIgnoreCase(viaProxy.getScheme())) {
          raw = handshake(tls.createSocket(raw, viaProxy.getHost(), proxyPort, true), viaProxy.getHost(), deadline);
        }
        if (https) {
          tunnel(raw, host, port, viaProxy, deadline);
        }
      }
      Socket socket = https ? handshake(tls.createSocket(raw, host, port, true), host, deadline) : raw;
      return new Conn(socket);
    } catch (IOException e) {
      try {
        raw.close();
      } catch (IOException ignored) {
        // closing
      }
      throw e;
    }
  }

  private static Socket handshake(Socket s, String host, long deadline) throws IOException {
    SSLSocket ssl = (SSLSocket) s;
    SSLParameters params = ssl.getSSLParameters();
    params.setEndpointIdentificationAlgorithm("HTTPS");
    ssl.setSSLParameters(params);
    setTimeout(ssl, deadline);
    ssl.startHandshake();
    return ssl;
  }

  private static void tunnel(Socket raw, String host, int port, URI viaProxy, long deadline) throws IOException {
    StringBuilder connect = new StringBuilder();
    String authority = (host.contains(":") ? "[" + host + "]" : host) + ":" + port;
    connect.append("CONNECT ").append(authority).append(" HTTP/1.1\r\nHost: ").append(authority).append("\r\n");
    String auth = proxyAuthorization(viaProxy);
    if (auth != null) {
      connect.append("Proxy-Authorization: ").append(auth).append("\r\n");
    }
    connect.append("\r\n");
    setTimeout(raw, deadline);
    OutputStream out = raw.getOutputStream();
    out.write(connect.toString().getBytes(StandardCharsets.ISO_8859_1));
    out.flush();
    InputStream in = raw.getInputStream();
    int status = parseStatus(readLineUnbuffered(in));
    while (!readLineUnbuffered(in).isEmpty()) {
      // skip the proxy's headers
    }
    if (status != 200) {
      throw new IOException("The proxy refused the tunnel (HTTP " + status + ").");
    }
  }

  private static @Nullable String proxyAuthorization(URI proxy) {
    String userInfo = proxy.getRawUserInfo();
    if (userInfo == null || userInfo.isEmpty()) {
      return null;
    }
    try {
      String decoded = URLDecoder.decode(userInfo.replace("+", "%2B"), "UTF-8");
      return "Basic " + Base64.getEncoder().encodeToString(decoded.getBytes(StandardCharsets.UTF_8));
    } catch (java.io.UnsupportedEncodingException e) {
      throw new IllegalStateException(e);
    }
  }

  private @Nullable URI proxyFor(boolean https, String host) {
    if (proxy != null) {
      return isLocal(host) ? null : proxy;
    }
    if (!systemProxy) {
      return null;
    }
    String prefix = https ? "https" : "http";
    String proxyHost = System.getProperty(prefix + ".proxyHost");
    if (proxyHost == null || proxyHost.isEmpty() || isLocal(host) || nonProxy(host)) {
      return null;
    }
    String proxyPort = System.getProperty(prefix + ".proxyPort", https ? "443" : "80");
    return URI.create("http://" + proxyHost + ":" + proxyPort);
  }

  private static boolean isLocal(String host) {
    return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "::1".equals(host);
  }

  private static boolean nonProxy(String host) {
    String list = System.getProperty("http.nonProxyHosts");
    if (list == null || list.isEmpty()) {
      return false;
    }
    for (String p : list.split("\\|")) {
      String glob = p.trim();
      if (!glob.isEmpty() && Pattern.compile(Pattern.quote(glob).replace("*", "\\E.*\\Q"), Pattern.CASE_INSENSITIVE).matcher(host).matches()) {
        return true;
      }
    }
    return false;
  }

  private synchronized @Nullable Conn takeIdle(String key) {
    Deque<Conn> q = idle.get(key);
    long now = System.currentTimeMillis();
    while (q != null && !q.isEmpty()) {
      Conn c = q.pollFirst();
      if (now - c.idleSince < IDLE_MS && !c.socket.isClosed()) {
        return c;
      }
      c.close();
    }
    return null;
  }

  private synchronized void giveBack(String key, Conn c) {
    Deque<Conn> q = idle.computeIfAbsent(key, k -> new ArrayDeque<>());
    c.idleSince = System.currentTimeMillis();
    q.addFirst(c);
    while (q.size() > MAX_IDLE_PER_HOST) {
      q.pollLast().close();
    }
  }

  /** Close idle connections. */
  public synchronized void closeIdle() {
    for (Deque<Conn> q : idle.values()) {
      for (Conn c : q) {
        c.close();
      }
    }
    idle.clear();
  }

  private static int remainingMillis(long deadline) throws SocketTimeoutException {
    long ms = (deadline - System.nanoTime()) / 1_000_000L;
    if (ms <= 0) {
      throw new SocketTimeoutException("deadline");
    }
    return (int) Math.min(Integer.MAX_VALUE, ms);
  }

  private static void setTimeout(Socket s, long deadline) throws IOException {
    s.setSoTimeout(remainingMillis(deadline));
  }

  private static int parseStatus(String line) throws IOException {
    String[] parts = line.split(" ", 3);
    if (parts.length < 2 || !parts[0].startsWith("HTTP/")) {
      throw new IOException("Malformed HTTP status line.");
    }
    return Integer.parseInt(parts[1]);
  }

  private static Map<String, String> readHeaders(InputStream in) throws IOException {
    Map<String, String> headers = new LinkedHashMap<>();
    int total = 0;
    while (true) {
      String line = readLine(in);
      if (line.isEmpty()) {
        return headers;
      }
      total += line.length();
      if (total > MAX_HEADER_BYTES) {
        throw new IOException("HTTP headers too large.");
      }
      int colon = line.indexOf(':');
      if (colon <= 0) {
        continue;
      }
      String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
      String value = line.substring(colon + 1).trim();
      headers.merge(name, value, (a, b) -> a + ", " + b);
    }
  }

  private static String readLine(InputStream in) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream(128);
    while (true) {
      int b = in.read();
      if (b < 0) {
        if (buf.size() == 0) {
          throw new EOFException("The connection closed.");
        }
        break;
      }
      if (b == '\n') {
        break;
      }
      if (b != '\r') {
        buf.write(b);
      }
      if (buf.size() > MAX_HEADER_BYTES) {
        throw new IOException("HTTP line too long.");
      }
    }
    return new String(buf.toByteArray(), StandardCharsets.ISO_8859_1);
  }

  private static String readLineUnbuffered(InputStream in) throws IOException {
    return readLine(in); // the CONNECT response is read byte by byte, so nothing of the tunnel is consumed
  }

  private static byte[] readFully(Conn c, long length, long deadline) throws IOException {
    if (length > Integer.MAX_VALUE - 8) {
      throw new IOException("Response too large.");
    }
    byte[] out = new byte[(int) length];
    int off = 0;
    while (off < out.length) {
      setTimeout(c.socket, deadline);
      int n = c.in.read(out, off, out.length - off);
      if (n < 0) {
        throw new EOFException("The connection closed mid-body.");
      }
      off += n;
    }
    return out;
  }

  private static byte[] readChunked(Conn c, long deadline) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    while (true) {
      setTimeout(c.socket, deadline);
      String sizeLine = readLine(c.in);
      int semi = sizeLine.indexOf(';');
      long size = Long.parseLong((semi >= 0 ? sizeLine.substring(0, semi) : sizeLine).trim(), 16);
      if (size == 0) {
        while (!readLine(c.in).isEmpty()) {
          // trailers
        }
        return out.toByteArray();
      }
      out.write(readFully(c, size, deadline));
      readLine(c.in);
    }
  }

  private static byte[] readToEof(Conn c, long deadline) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    while (true) {
      setTimeout(c.socket, deadline);
      int n = c.in.read(buf);
      if (n < 0) {
        return out.toByteArray();
      }
      out.write(buf, 0, n);
    }
  }
}
