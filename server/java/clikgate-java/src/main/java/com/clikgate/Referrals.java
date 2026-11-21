package com.clikgate;

import com.clikgate.exception.NotFoundException;
import com.clikgate.http.RequestOptions;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.Requester;
import com.clikgate.model.Job;
import com.clikgate.model.Page;
import com.clikgate.model.Referral;
import com.clikgate.model.Referrer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Referrals: referrers (get or create, find, block, update, import) and referrals (read, list, qualify,
 * disqualify, complete a step). Every method returns a typed model.
 */
public final class Referrals {
  /** Rows per import request; longer lists are sent in several requests. */
  public static final int IMPORT_BATCH_SIZE = 1000;

  private final Core core;

  Referrals(Core core) {
    this.core = core;
  }

  private static String seg(@Nullable String value, String name) {
    return Requester.encodePathSegment(Requester.requireId(value, name));
  }

  private static String program(String programId) {
    return "/v1/referral-programs/" + seg(programId, "program_id");
  }

  private static String referrer(String referrerId) {
    return "/v1/referrers/" + seg(referrerId, "referrer_id");
  }

  private static String referral(String referralId) {
    return "/v1/referrals/" + seg(referralId, "referral_id");
  }

  private Requester.Result call(ApiRequest req) {
    return core.requester.request(req);
  }

  private Referrer referrerOf(ApiRequest req) {
    return new Referrer(Links.asMap(call(req).data));
  }

  private Referral referralOf(ApiRequest req) {
    return new Referral(Links.asMap(call(req).data));
  }

  /**
   * The customer's referrer in a program, created on first call ({@link Referrer#isCreated()} is then true). Call it
   * when your signed-in user opens "Invite friends".
   *
   * <pre>{@code
   * Referrer referrer = clikgate.referrals().getOrCreateReferrer("rpg_01J…", GetOrCreateReferrerParams.of(user.getId()));
   * String share = referrer.getUrl();
   * }</pre>
   */
  public Referrer getOrCreateReferrer(String programId, GetOrCreateReferrerParams params) {
    return getOrCreateReferrer(programId, params, RequestOptions.NONE);
  }

  /**
   * {@link #getOrCreateReferrer(String, GetOrCreateReferrerParams)} with only your signed-in user's ID.
   *
   * <pre>{@code
   * Referrer referrer = clikgate.referrals().getOrCreateReferrer("rpg_01J…", user.getId());
   * }</pre>
   */
  public Referrer getOrCreateReferrer(String programId, String customerId) {
    return getOrCreateReferrer(programId, GetOrCreateReferrerParams.of(customerId), RequestOptions.NONE);
  }

  /** {@link #getOrCreateReferrer(String, GetOrCreateReferrerParams)} with per-call options. */
  public Referrer getOrCreateReferrer(String programId, GetOrCreateReferrerParams params, RequestOptions options) {
    Map<String, Object> body = params.wire();
    Requester.Result r = call(new ApiRequest("POST", program(programId) + "/referrers").body(body).options(options));
    return new Referrer(Links.asMap(r.data), r.status == 201);
  }

  /**
   * A referrer by ID.
   *
   * <pre>{@code
   * Referrer referrer = clikgate.referrals().getReferrer("rfr_01J…");
   * }</pre>
   */
  public Referrer getReferrer(String referrerId) {
    return getReferrer(referrerId, RequestOptions.NONE);
  }

  /** {@link #getReferrer(String)} with per-call options. */
  public Referrer getReferrer(String referrerId, RequestOptions options) {
    return referrerOf(new ApiRequest("GET", referrer(referrerId)).options(options));
  }

  /**
   * A program's referrer by your customer ID or by referral code; null when there is none (a {@code 404}).
   *
   * <pre>{@code
   * Referrer r = clikgate.referrals().findReferrer("rpg_01J…", FindReferrerParams.byCode("ADA42"));
   * if (r == null) { ... }
   * }</pre>
   */
  public @Nullable Referrer findReferrer(String programId, FindReferrerParams params) {
    return findReferrer(programId, params, RequestOptions.NONE);
  }

  /** {@link #findReferrer(String, FindReferrerParams)} with per-call options. */
  public @Nullable Referrer findReferrer(String programId, FindReferrerParams params, RequestOptions options) {
    if ((params.code == null) == (params.customerId == null)) {
      throw com.clikgate.internal.ErrorMapper.local("invalid_argument", "Give exactly one of customerId and code.", params.code == null ? "customer_id" : "code");
    }
    String path =
        params.code != null
            ? program(programId) + "/referrers/by-code/" + seg(params.code, "code")
            : program(programId) + "/referrers/by-user/" + seg(params.customerId, "customer_id");
    try {
      return referrerOf(new ApiRequest("GET", path).options(options));
    } catch (NotFoundException e) {
      return null;
    }
  }

  /**
   * A referral by ID.
   *
   * <pre>{@code
   * Referral referral = clikgate.referrals().get("ref_01J…");
   * }</pre>
   */
  public Referral get(String referralId) {
    return get(referralId, RequestOptions.NONE);
  }

  /** {@link #get(String)} with per-call options. */
  public Referral get(String referralId, RequestOptions options) {
    return referralOf(new ApiRequest("GET", referral(referralId)).options(options));
  }

  /**
   * One page of referrals.
   *
   * <pre>{@code
   * Page<Referral> page = clikgate.referrals().listPage(ListReferralsParams.builder().status("qualified").build());
   * }</pre>
   */
  public Page<Referral> listPage(ListReferralsParams params) {
    return listPage(params, RequestOptions.NONE);
  }

  /** {@link #listPage(ListReferralsParams)} with per-call options. */
  public Page<Referral> listPage(ListReferralsParams params, RequestOptions options) {
    return page(params.query(), options);
  }

  private Page<Referral> page(Map<String, Object> query, RequestOptions options) {
    return new Page<>(Links.asMap(call(new ApiRequest("GET", "/v1/referrals", query).options(options)).data), Referral::new);
  }

  /**
   * Every referral matching the filters, fetching pages lazily as you iterate.
   *
   * <pre>{@code
   * for (Referral r : clikgate.referrals().list(ListReferralsParams.builder().programId("rpg_01J…").build())) { ... }
   * }</pre>
   */
  public Iterable<Referral> list(ListReferralsParams params) {
    return list(params, RequestOptions.NONE);
  }

  /** Every referral. */
  public Iterable<Referral> list() {
    return list(ListReferralsParams.NONE, RequestOptions.NONE);
  }

  /** {@link #list(ListReferralsParams)} with per-call options. */
  public Iterable<Referral> list(ListReferralsParams params, RequestOptions options) {
    Map<String, Object> base = params.query();
    return new Pager<>(
        cursor -> {
          Map<String, Object> q = new LinkedHashMap<>(base);
          if (cursor != null) {
            q.put("starting_after", cursor);
          }
          return page(q, options);
        });
  }

  /**
   * Qualify a referral by hand (audit-logged).
   *
   * <pre>{@code
   * clikgate.referrals().qualify("ref_01J…", "Verified with support ticket #812");
   * }</pre>
   */
  public Referral qualify(String referralId, String reason) {
    return qualify(referralId, reason, RequestOptions.NONE);
  }

  /** {@link #qualify(String, String)} with per-call options. */
  public Referral qualify(String referralId, String reason, RequestOptions options) {
    return override(referralId, "qualify", reason, options);
  }

  /**
   * Disqualify a referral by hand (audit-logged).
   *
   * <pre>{@code
   * clikgate.referrals().disqualify("ref_01J…", "Same household");
   * }</pre>
   */
  public Referral disqualify(String referralId, String reason) {
    return disqualify(referralId, reason, RequestOptions.NONE);
  }

  /** {@link #disqualify(String, String)} with per-call options. */
  public Referral disqualify(String referralId, String reason, RequestOptions options) {
    return override(referralId, "disqualify", reason, options);
  }

  private Referral override(String referralId, String action, String reason, RequestOptions options) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("action", action);
    body.put("reason", Requester.requireId(reason, "reason"));
    return referralOf(new ApiRequest("POST", referral(referralId) + "/override").body(body).options(options));
  }

  /**
   * Complete the referral's current goal step from your server.
   *
   * <pre>{@code
   * clikgate.referrals().completeStep("ref_01J…", CompleteStepParams.builder().goal("first_deposit").occurredAt(Instant.now()).value(15000).currency("NGN").build());
   * }</pre>
   */
  public Referral completeStep(String referralId, CompleteStepParams params) {
    return completeStep(referralId, params, RequestOptions.NONE);
  }

  /** {@link #completeStep(String, CompleteStepParams)} with per-call options. */
  public Referral completeStep(String referralId, CompleteStepParams params, RequestOptions options) {
    String path = referral(referralId) + "/steps";
    Map<String, Object> body = params.wire();
    return referralOf(new ApiRequest("POST", path).body(body).options(options));
  }

  /**
   * Import existing referrers (created or updated by background jobs). Lists longer than
   * {@link #IMPORT_BATCH_SIZE} rows are sent in several requests, one job each.
   *
   * <pre>{@code
   * List<Job> jobs = clikgate.referrals().importReferrers("rpg_01J…", Arrays.asList(ReferrerImport.of("user_1"), ReferrerImport.of("user_2")));
   * }</pre>
   */
  public List<Job> importReferrers(String programId, List<ReferrerImport> rows) {
    return importReferrers(programId, rows, RequestOptions.NONE);
  }

  /**
   * {@link #importReferrers(String, List)} with per-call options. With an idempotency key {@code K}, the first request
   * uses {@code K} and the next ones {@code K:1}, {@code K:2}, ..., so the whole import can be resent safely.
   */
  public List<Job> importReferrers(String programId, List<ReferrerImport> rows, RequestOptions options) {
    String path = program(programId) + "/referrers/import";
    if (rows.isEmpty()) {
      return Collections.emptyList();
    }
    List<Job> jobs = new ArrayList<>();
    for (int from = 0; from < rows.size(); from += IMPORT_BATCH_SIZE) {
      List<Object> batch = new ArrayList<>();
      for (ReferrerImport row : rows.subList(from, Math.min(rows.size(), from + IMPORT_BATCH_SIZE))) {
        batch.add(row.wire());
      }
      Map<String, Object> body = Collections.<String, Object>singletonMap("referrers", batch);
      RequestOptions o = options;
      String key = options.getIdempotencyKey();
      if (key != null && from > 0) {
        RequestOptions.Builder b = RequestOptions.builder().idempotencyKey(key + ":" + (from / IMPORT_BATCH_SIZE));
        if (options.getTimeout() != null) {
          b.timeout(options.getTimeout());
        }
        if (options.getMaxRetries() != null) {
          b.maxRetries(options.getMaxRetries().intValue());
        }
        o = b.build();
      }
      jobs.add(new Job(Links.asMap(call(new ApiRequest("POST", path).body(body).options(o)).data)));
    }
    return Collections.unmodifiableList(jobs);
  }

  /**
   * Block a referrer: their code and link stop creating referrals.
   *
   * <pre>{@code
   * clikgate.referrals().blockReferrer("rfr_01J…", "Self-referrals");
   * }</pre>
   */
  public Referrer blockReferrer(String referrerId, @Nullable String reason) {
    return blockReferrer(referrerId, reason, RequestOptions.NONE);
  }

  /** {@link #blockReferrer(String, String)} without a reason. */
  public Referrer blockReferrer(String referrerId) {
    return blockReferrer(referrerId, null, RequestOptions.NONE);
  }

  /** {@link #blockReferrer(String, String)} with per-call options. */
  public Referrer blockReferrer(String referrerId, @Nullable String reason, RequestOptions options) {
    Map<String, Object> body = reason == null ? Collections.<String, Object>emptyMap() : Collections.<String, Object>singletonMap("reason", reason);
    return referrerOf(new ApiRequest("POST", referrer(referrerId) + "/block").body(body).options(options));
  }

  /**
   * Unblock a referrer.
   *
   * <pre>{@code
   * clikgate.referrals().unblockReferrer("rfr_01J…");
   * }</pre>
   */
  public Referrer unblockReferrer(String referrerId) {
    return unblockReferrer(referrerId, RequestOptions.NONE);
  }

  /** {@link #unblockReferrer(String)} with per-call options. */
  public Referrer unblockReferrer(String referrerId, RequestOptions options) {
    return referrerOf(new ApiRequest("POST", referrer(referrerId) + "/unblock").options(options));
  }

  /**
   * Change a referrer's display name or attributes.
   *
   * <pre>{@code
   * clikgate.referrals().updateReferrer("rfr_01J…", UpdateReferrerParams.builder().displayName("Ada L.").build());
   * }</pre>
   */
  public Referrer updateReferrer(String referrerId, UpdateReferrerParams params) {
    return updateReferrer(referrerId, params, RequestOptions.NONE);
  }

  /** {@link #updateReferrer(String, UpdateReferrerParams)} with per-call options. */
  public Referrer updateReferrer(String referrerId, UpdateReferrerParams params, RequestOptions options) {
    String path = referrer(referrerId);
    return referrerOf(new ApiRequest("PATCH", path).body(params.wire()).options(options));
  }
}
