package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.http.TransportResponse;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Requester;
import com.clikgate.model.Link;
import com.clikgate.model.LinkChangeRequest;
import com.clikgate.model.LinkPage;
import com.clikgate.model.LinkUpdateResult;
import com.clikgate.model.QrCode;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import org.jspecify.annotations.Nullable;

/** Links: create, read, update (with approvals and locks), list and QR codes. {@code params} use the API's field names. */
public final class Links {
  private final Core core;

  Links(Core core) {
    this.core = core;
  }

  @SuppressWarnings("unchecked")
  static @Nullable Map<String, ?> asMap(@Nullable Object data) {
    return data instanceof Map ? (Map<String, ?>) data : null;
  }

  private static String path(String id) {
    return "/v1/links/" + Requester.encodePathSegment(Requester.requireId(id, "id"));
  }

  /**
   * Create a link. Its warnings include {@code no_preview} when there is no preview title and image.
   *
   * <pre>{@code
   * Map<String, Object> p = new HashMap<>();
   * p.put("destination_url", "https://example.com/spring"); p.put("og_title", "Spring sale");
   * Link link = clikgate.links().create(p);
   * }</pre>
   */
  public Link create(Map<String, ?> params) {
    return create(params, RequestOptions.NONE);
  }

  /** {@link #create(Map)} with per-call options. */
  public Link create(Map<String, ?> params, RequestOptions options) {
    return new Link(asMap(core.requester.request(new ApiRequest("POST", "/v1/links").body(params).options(options)).data));
  }

  /**
   * Fetch a link by ID.
   *
   * <pre>{@code
   * Link link = clikgate.links().get("lnk_01J…");
   * }</pre>
   */
  public Link get(String id) {
    return get(id, RequestOptions.NONE);
  }

  /** {@link #get(String)} with per-call options. */
  public Link get(String id, RequestOptions options) {
    return new Link(asMap(core.requester.request(new ApiRequest("GET", path(id)).options(options)).data));
  }

  /**
   * Update a link. A null value clears a field. With two-person approval on, a destination change answers
   * {@code 202} and {@link LinkUpdateResult#isApplied()} is false; a locked link throws {@code LinkLockedException}.
   *
   * <pre>{@code
   * LinkUpdateResult r = clikgate.links().update("lnk_01J…", Collections.singletonMap("destination_url", "https://example.com/summer"));
   * if (!r.isApplied()) System.out.println("waiting for approval: " + r.getChangeRequest().getId());
   * }</pre>
   */
  public LinkUpdateResult update(String id, Map<String, ?> params) {
    return update(id, params, RequestOptions.NONE);
  }

  /** {@link #update(String, Map)} with per-call options. */
  public LinkUpdateResult update(String id, Map<String, ?> params, RequestOptions options) {
    Requester.Result r = core.requester.request(new ApiRequest("PATCH", path(id)).body(new LinkedHashMap<String, Object>(params)).options(options));
    if (r.status == 202) {
      return new LinkUpdateResult(false, null, new LinkChangeRequest(asMap(r.data)));
    }
    return new LinkUpdateResult(true, new Link(asMap(r.data)), null);
  }

  /**
   * Fetch one page of links ({@code limit} 1-100, {@code starting_after}, {@code ending_before}, {@code status}, {@code tag}, …).
   *
   * <pre>{@code
   * LinkPage page = clikgate.links().listPage(Collections.singletonMap("limit", 100));
   * }</pre>
   */
  public LinkPage listPage(Map<String, ?> params) {
    return listPage(params, RequestOptions.NONE);
  }

  /** {@link #listPage(Map)} with per-call options. */
  public LinkPage listPage(Map<String, ?> params, RequestOptions options) {
    return new LinkPage(asMap(core.requester.request(new ApiRequest("GET", "/v1/links", params).options(options)).data));
  }

  /**
   * Every link, fetching pages lazily as you iterate.
   *
   * <pre>{@code
   * for (Link link : clikgate.links().list(Collections.singletonMap("limit", 100))) System.out.println(link.getShortUrl());
   * }</pre>
   */
  public Iterable<Link> list(Map<String, ?> params) {
    return list(params, RequestOptions.NONE);
  }

  /** All links. */
  public Iterable<Link> list() {
    return list(Collections.<String, Object>emptyMap(), RequestOptions.NONE);
  }

  /** {@link #list(Map)} with per-call options. */
  public Iterable<Link> list(Map<String, ?> params, RequestOptions options) {
    return () ->
        new Iterator<Link>() {
          private @Nullable Iterator<Link> page;
          private @Nullable String cursor;
          private boolean last;

          @Override
          public boolean hasNext() {
            while (page == null || !page.hasNext()) {
              if (last) {
                return false;
              }
              Map<String, Object> p = new LinkedHashMap<>(params);
              if (cursor != null) {
                p.put("starting_after", cursor);
              }
              LinkPage lp = listPage(p, options);
              List<Link> data = lp.getData();
              page = data.iterator();
              cursor = lp.getNextCursor();
              last = !lp.hasMore() || cursor == null || cursor.isEmpty();
            }
            return true;
          }

          @Override
          public Link next() {
            if (!hasNext()) {
              throw new NoSuchElementException();
            }
            Iterator<Link> p = page;
            if (p == null) {
              throw new NoSuchElementException();
            }
            return p.next();
          }
        };
  }

  /**
   * Download the link's QR code ({@code format} svg|png, {@code size} 256-2048, {@code margin}, {@code dark}, {@code light}).
   *
   * <pre>{@code
   * QrCode qr = clikgate.links().qr("lnk_01J…", Collections.singletonMap("format", "png"));
   * Files.write(Paths.get("qr.png"), qr.getData());
   * }</pre>
   */
  public QrCode qr(String id, Map<String, ?> options) {
    return qr(id, options, RequestOptions.NONE);
  }

  /** {@link #qr(String, Map)} with per-call options. */
  public QrCode qr(String id, Map<String, ?> query, RequestOptions options) {
    TransportResponse res = core.requester.send(new ApiRequest("GET", path(id) + "/qr", query).options(options));
    String type = res.header("content-type");
    return new QrCode(type == null ? "application/octet-stream" : type, res.getBody());
  }
}
