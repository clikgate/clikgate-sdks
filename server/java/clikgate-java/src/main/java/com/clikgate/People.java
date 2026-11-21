package com.clikgate;

import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Requester;
import com.clikgate.model.Page;
import com.clikgate.model.Person;
import com.clikgate.model.PersonSummary;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** People: read a person, search people and set the label your team sees. */
public final class People {
  private final Core core;

  People(Core core) {
    this.core = core;
  }

  private static String path(String personId) {
    return "/v1/people/" + Requester.encodePathSegment(Requester.requireId(personId, "person_id"));
  }

  /**
   * A person by ID.
   *
   * <pre>{@code
   * Person person = clikgate.people().get("per_01J…");
   * }</pre>
   */
  public Person get(String personId) {
    return get(personId, RequestOptions.NONE);
  }

  /** {@link #get(String)} with per-call options. */
  public Person get(String personId, RequestOptions options) {
    return new Person(Links.asMap(core.requester.request(new ApiRequest("GET", path(personId)).options(options)).data));
  }

  /**
   * One page of people matching a label, customer ID or click ID.
   *
   * @param cursor a page's {@code getNextCursor()}, or null for the first page
   * @param limit page size, or null for the API's default
   */
  public Page<PersonSummary> searchPage(String q, @Nullable String cursor, @Nullable Integer limit) {
    return searchPage(q, cursor, limit, RequestOptions.NONE);
  }

  /** {@link #searchPage(String, String, Integer)} with per-call options. */
  public Page<PersonSummary> searchPage(String q, @Nullable String cursor, @Nullable Integer limit, RequestOptions options) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("q", q);
    if (cursor != null) {
      body.put("cursor", cursor);
    }
    if (limit != null) {
      body.put("limit", limit);
    }
    return new Page<>(Links.asMap(core.requester.request(new ApiRequest("POST", "/v1/people/search").body(body).options(options)).data), PersonSummary::new);
  }

  /**
   * Every person matching a label, customer ID or click ID, fetching pages lazily as you iterate.
   *
   * <pre>{@code
   * for (PersonSummary p : clikgate.people().search("ada")) System.out.println(p.getId());
   * }</pre>
   */
  public Iterable<PersonSummary> search(String q) {
    return search(q, RequestOptions.NONE);
  }

  /** {@link #search(String)} with per-call options. */
  public Iterable<PersonSummary> search(String q, RequestOptions options) {
    return new Pager<>(cursor -> searchPage(q, cursor, null, options));
  }

  /**
   * Set the label your team sees instead of the click ID ({@code ""} clears it).
   *
   * <pre>{@code
   * clikgate.people().setLabel("per_01J…", "Ada (VIP)");
   * }</pre>
   */
  public Person setLabel(String personId, String label) {
    return setLabel(personId, label, RequestOptions.NONE);
  }

  /** {@link #setLabel(String, String)} with per-call options. */
  public Person setLabel(String personId, String label, RequestOptions options) {
    Map<String, Object> body = Collections.<String, Object>singletonMap("label", label);
    return new Person(Links.asMap(core.requester.request(new ApiRequest("PATCH", path(personId)).body(body).options(options)).data));
  }
}
