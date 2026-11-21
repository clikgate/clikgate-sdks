package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.NotFoundException;
import com.clikgate.http.Clock;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import com.clikgate.internal.Json;
import com.clikgate.model.CodeRedemption;
import com.clikgate.model.EventType;
import com.clikgate.model.Install;
import com.clikgate.model.Job;
import com.clikgate.model.Link;
import com.clikgate.model.Page;
import com.clikgate.model.Person;
import com.clikgate.model.PersonSummary;
import com.clikgate.model.PrivacyRequest;
import com.clikgate.model.Referral;
import com.clikgate.model.Referrer;
import com.clikgate.model.WebhookEvent;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class TypedSurfaceTest {
  private static final String KEY = "cg_test_unit000000000000";
  private static final String REFERRER =
      "{\"object\":\"referrer\",\"id\":\"rfr_1\",\"program_id\":\"rpg_1\",\"customer_user_id\":\"user_42\",\"display_name\":\"Ada\",\"code\":\"ADA42\","
          + "\"external_code\":null,\"link_id\":\"lnk_1\",\"url\":\"https://ciz.to/r/ADA42\",\"short_url\":\"https://ciz.to/x\",\"status\":\"active\","
          + "\"blocked_reason\":null,\"blocked_at\":null,\"stats\":{\"clicks\":3,\"installs\":2,\"signups\":1,\"in_progress\":1,\"qualified\":1,"
          + "\"disqualified\":0,\"rejected\":0},\"attributes\":{\"tier\":\"gold\"},\"leaderboard_opt_out\":false,\"quality_score\":null,"
          + "\"quality_band\":null,\"last_activity_at\":\"2026-11-01T10:00:00Z\",\"created_at\":\"2026-10-01T10:00:00Z\",\"updated_at\":\"2026-10-02T10:00:00Z\",\"livemode\":false}";
  private static final String REFERRAL =
      "{\"object\":\"referral\",\"id\":\"ref_1\",\"program_id\":\"rpg_1\",\"referrer_id\":\"rfr_1\",\"status\":\"qualified\",\"source\":\"link\","
          + "\"match_type\":\"deterministic\",\"current_step\":1,\"steps_completed\":[{\"index\":0,\"goal\":\"first_deposit\",\"completed_at\":\"2026-11-01T10:00:00Z\"}],"
          + "\"step_deadline_at\":null,\"hold_until\":null,\"qualified_at\":\"2026-11-02T10:00:00Z\",\"disqualified_at\":null,\"rejected_at\":null,"
          + "\"reason\":null,\"fraud_flags\":[],\"referee_uninstalled_after_qualification\":false,\"program\":{\"id\":\"rpg_1\",\"name\":\"Invite friends\"},"
          + "\"referrer\":{\"id\":\"rfr_1\",\"customer_user_id\":\"user_42\",\"code\":\"ADA42\"},\"referee\":{\"install_id\":\"ins_1\",\"installation_id\":\"inst_1\","
          + "\"customer_user_id\":\"user_77\"},\"link\":{\"id\":\"lnk_1\"},\"click_id\":\"clk_1\",\"reward_snapshot\":{\"referrer\":{\"amount_minor\":150050,"
          + "\"currency\":\"NGN\",\"description\":\"N1,500.50 credit\"},\"referee\":{\"amount_minor\":500,\"currency\":\"JPY\"}},"
          + "\"created_at\":\"2026-10-30T10:00:00Z\",\"updated_at\":\"2026-11-02T10:00:00Z\",\"livemode\":false}";

  /** Answers from a queue and records every request. */
  static final class Scripted implements Transport {
    final List<TransportRequest> requests = new ArrayList<>();
    final Deque<Object[]> answers = new ArrayDeque<>();

    Scripted then(int status, String body) {
      answers.add(new Object[] {status, body});
      return this;
    }

    @Override
    public TransportResponse send(TransportRequest request) {
      requests.add(request);
      Object[] a = answers.isEmpty() ? new Object[] {500, "{}"} : answers.poll();
      return new TransportResponse((Integer) a[0], Collections.singletonMap("content-type", "application/json"), ((String) a[1]).getBytes(StandardCharsets.UTF_8));
    }

    String path(int i) {
      return requests.get(i).getUrl().replaceAll("^https?://[^/]+", "");
    }

    @SuppressWarnings("unchecked")
    Map<String, Object> body(int i) throws Exception {
      byte[] b = requests.get(i).getBody();
      return b == null ? null : (Map<String, Object>) Json.parse(b);
    }
  }

  private static Clikgate client(Scripted t) {
    return Clikgate.builder()
        .apiKey(KEY)
        .transport(t)
        .privateMode(PrivateMode.OFF)
        .maxRetries(0)
        .shutdownHooks(false)
        .clock(
            new Clock() {
              @Override
              public long nowMillis() {
                return Instant.parse("2026-11-21T12:00:00Z").toEpochMilli();
              }

              @Override
              public void sleep(Duration d) {}
            })
        .build();
  }

  private static String page(String item, boolean hasMore, String next) {
    return "{\"object\":\"list\",\"data\":[" + item + "],\"has_more\":" + hasMore + ",\"next_cursor\":" + (next == null ? "null" : "\"" + next + "\"") + "}";
  }

  @Test
  void getOrCreateReferrerReadsTheTypedReferrerAndTheCreatedFlag() throws Exception {
    Scripted t = new Scripted().then(201, REFERRER).then(200, REFERRER);
    Clikgate c = client(t);
    Referrer r = c.referrals().getOrCreateReferrer("rpg_1", GetOrCreateReferrerParams.builder().customerId("user_42").displayName("Ada").code("ADA42").build());
    assertTrue(r.isCreated());
    assertEquals("user_42", r.getCustomerId());
    assertEquals("ADA42", r.getCode());
    assertEquals(3L, r.getStats().getClicks());
    assertEquals(1L, r.getStats().getInProgress());
    assertEquals("gold", r.getAttributes().get("tier"));
    assertEquals(Instant.parse("2026-10-01T10:00:00Z"), r.getCreatedAt());
    assertEquals("/v1/referral-programs/rpg_1/referrers", t.path(0));
    assertEquals("{customer_user_id=user_42, display_name=Ada, code=ADA42}", String.valueOf(t.body(0)));
    assertNull(r.getStats().getRefereeUninstallRate7d());
    assertFalse(c.referrals().getOrCreateReferrer("rpg_1", "user_42").isCreated());
    assertEquals("{customer_user_id=user_42}", String.valueOf(t.body(1)));
    assertThrows(InvalidRequestException.class, () -> c.referrals().getOrCreateReferrer("rpg_1", GetOrCreateReferrerParams.builder().build()));
  }

  @Test
  void findReferrerIsNullOn404AndOtherwiseThrows() {
    String notFound = "{\"error\":{\"type\":\"not_found\",\"code\":\"referrer_not_found\",\"message\":\"No referrer.\"}}";
    Scripted t = new Scripted().then(404, notFound).then(200, REFERRER).then(404, notFound);
    Clikgate c = client(t);
    assertNull(c.referrals().findReferrer("rpg_1", FindReferrerParams.byCustomerId("user 9")));
    assertEquals("/v1/referral-programs/rpg_1/referrers/by-user/user%209", t.path(0));
    assertEquals("rfr_1", c.referrals().findReferrer("rpg_1", FindReferrerParams.byCode("ADA42")).getId());
    assertEquals("/v1/referral-programs/rpg_1/referrers/by-code/ADA42", t.path(1));
    assertThrows(NotFoundException.class, () -> c.referrals().getReferrer("rfr_x"));
  }

  @Test
  void referralModelReadsNestedObjectsAndMoney() throws Exception {
    Scripted t = new Scripted().then(200, REFERRAL);
    Referral r = client(t).referrals().get("ref_1");
    assertEquals("qualified", r.getStatus());
    assertEquals("Invite friends", r.getProgram().getName());
    assertEquals("user_42", r.getReferrer().getCustomerId());
    assertEquals("user_77", r.getReferee().getCustomerId());
    assertEquals("lnk_1", r.getLinkId());
    assertEquals("first_deposit", r.getStepsCompleted().get(0).getGoal());
    assertEquals(Long.valueOf(150050L), r.getReward().getReferrer().getAmountMinor());
    assertEquals(new BigDecimal("1500.50"), r.getReward().getReferrer().getAmount());
    assertEquals(new BigDecimal("500"), r.getReward().getReferee().getAmount());
    assertNull(r.getReward().getNote());
  }

  @Test
  void listPagesLazilyWithTheCursor() {
    Scripted t = new Scripted().then(200, page(REFERRAL, true, "ref_1")).then(200, page(REFERRAL, false, null));
    Clikgate c = client(t);
    List<Referral> all = new ArrayList<>();
    for (Referral r : c.referrals().list(ListReferralsParams.builder().programId("rpg_1").refereeCustomerId("user_77").reason(null).limit(1).build())) {
      all.add(r);
    }
    assertEquals(2, all.size());
    assertEquals("/v1/referrals?program_id=rpg_1&referee_customer_user_id=user_77&limit=1", t.path(0));
    assertEquals("/v1/referrals?program_id=rpg_1&referee_customer_user_id=user_77&limit=1&starting_after=ref_1", t.path(1));
    Page<Referral> p = client(new Scripted().then(200, page(REFERRAL, true, "c2"))).referrals().listPage(ListReferralsParams.NONE);
    assertTrue(p.hasMore());
    assertEquals("c2", p.getNextCursor());
  }

  @Test
  void overridesStepsBlockAndUpdate() throws Exception {
    Scripted t = new Scripted().then(200, REFERRAL).then(200, REFERRAL).then(200, REFERRAL).then(200, REFERRER).then(200, REFERRER).then(200, REFERRER).then(200, REFERRER);
    Clikgate c = client(t);
    c.referrals().qualify("ref_1", "ticket 812");
    c.referrals().disqualify("ref_1", "same household");
    c.referrals().completeStep("ref_1", CompleteStepParams.builder().goal("first_deposit").occurredAt(Instant.parse("2026-11-21T12:00:00Z")).value(new BigDecimal("15000.50")).currency("NGN").build());
    c.referrals().blockReferrer("rfr_1", "self-referrals");
    c.referrals().blockReferrer("rfr_1");
    c.referrals().unblockReferrer("rfr_1");
    c.referrals().updateReferrer("rfr_1", UpdateReferrerParams.builder().displayName(null).externalCode("ADA-OLD").leaderboardOptOut(true).attributes(Collections.singletonMap("tier", "gold")).build());
    assertEquals("{action=qualify, reason=ticket 812}", String.valueOf(t.body(0)));
    assertEquals("/v1/referrals/ref_1/override", t.path(1));
    assertEquals("{action=disqualify, reason=same household}", String.valueOf(t.body(1)));
    assertEquals("/v1/referrals/ref_1/steps", t.path(2));
    assertEquals("{goal=first_deposit, occurred_at=2026-11-21T12:00:00Z, value=15000.50, currency=NGN}", String.valueOf(t.body(2)));
    InvalidRequestException missing = assertThrows(InvalidRequestException.class, () -> c.referrals().completeStep("ref_1", CompleteStepParams.builder().goal("first_deposit").build()));
    assertEquals("occurred_at", missing.getParam());
    assertEquals("/v1/referrers/rfr_1/block", t.path(3));
    assertEquals("{reason=self-referrals}", String.valueOf(t.body(3)));
    assertEquals("{}", String.valueOf(t.body(4)));
    assertEquals("/v1/referrers/rfr_1/unblock", t.path(5));
    assertEquals("PATCH", t.requests.get(6).getMethod());
    assertEquals("{display_name=null, external_code=ADA-OLD, leaderboard_opt_out=true, attributes={tier=gold}}", String.valueOf(t.body(6)));
    @SuppressWarnings("unchecked")
    Map<String, Object> goal = (Map<String, Object>) Json.parse("{\"object\":\"goal_event\",\"link\":{\"id\":\"lnk_1\"},\"campaign\":{\"id\":\"cmp_1\"}}");
    assertEquals("lnk_1", new com.clikgate.model.GoalEvent(goal).getLinkId());
    assertEquals("cmp_1", new com.clikgate.model.GoalEvent(goal).getCampaignId());
    @SuppressWarnings("unchecked")
    Map<String, Object> answer = (Map<String, Object>) Json.parse("{\"object\":\"goal_event\",\"attributed_to\":{\"link_id\":\"lnk_2\",\"campaign_id\":null}}");
    assertEquals("lnk_2", new com.clikgate.model.GoalEvent(answer).getLinkId());
    assertNull(new com.clikgate.model.GoalEvent(answer).getCampaignId());
  }

  @Test
  void importReferrersSplitsIntoBatchesOf1000() throws Exception {
    String job = "{\"object\":\"job\",\"id\":\"job_1\",\"type\":\"referrer_import\",\"status\":\"queued\",\"total\":1000,\"succeeded\":0,\"failed\":0,"
        + "\"results\":[{\"index\":0,\"ok\":true,\"referrer_id\":\"rfr_1\",\"created\":true}],\"created_at\":\"2026-11-21T12:00:00Z\",\"finished_at\":null}";
    Scripted t = new Scripted().then(202, job).then(202, job).then(202, job);
    List<ReferrerImport> rows = new ArrayList<>();
    for (int i = 0; i < 2500; i++) {
      rows.add(ReferrerImport.of("user_" + i).displayName(i == 0 ? "Ada" : null));
    }
    List<Job> jobs = client(t).referrals().importReferrers("rpg_1", rows);
    assertEquals(3, jobs.size());
    assertEquals(3, t.requests.size());
    assertEquals(1000, ((List<?>) t.body(0).get("referrers")).size());
    assertEquals(500, ((List<?>) t.body(2).get("referrers")).size());
    assertEquals("{customer_user_id=user_0, display_name=Ada}", String.valueOf(((List<?>) t.body(0).get("referrers")).get(0)));
    assertEquals("rfr_1", jobs.get(0).getResults().get(0).getReferrerId());
    assertEquals(Boolean.TRUE, jobs.get(0).getResults().get(0).getCreated());
    String k0 = t.requests.get(0).getHeaders().get("Idempotency-Key");
    String k1 = t.requests.get(1).getHeaders().get("Idempotency-Key");
    assertFalse(k0 == null || k0.equals(k1));
  }

  @Test
  void webhookAccessorsReadTheTypedObject() throws Exception {
    @SuppressWarnings("unchecked")
    Map<String, Object> raw = (Map<String, Object>) Json.parse("{\"id\":\"evt_1\",\"object\":\"event\",\"type\":\"referral.qualified\",\"api_version\":\"2026-10-01\","
        + "\"created_at\":\"2026-11-02T10:00:00Z\",\"organization_id\":\"org_1\",\"livemode\":true,\"data\":{\"object\":" + REFERRAL + ",\"previous_attributes\":null}}");
    WebhookEvent ev = new WebhookEvent(raw);
    assertEquals(EventType.REFERRAL_QUALIFIED, ev.getType());
    assertEquals("2026-10-01", ev.getApiVersion());
    assertEquals("org_1", ev.getOrganizationId());
    assertEquals("ref_1", ev.asReferral().getId());
    IllegalStateException e = assertThrows(IllegalStateException.class, ev::asReferrer);
    assertTrue(e.getMessage().contains("referrer."));
    assertThrows(IllegalStateException.class, ev::asPayment);
    assertThrows(IllegalStateException.class, ev::asDeviceChange);
    @SuppressWarnings("unchecked")
    Map<String, Object> dc = (Map<String, Object>) Json.parse("{\"id\":\"evt_2\",\"type\":\"person.device_changed\",\"data\":{\"object\":{\"object\":\"device_change\","
        + "\"device_change_id\":\"dvc_1\",\"person_id\":\"per_1\",\"kind\":\"switch\",\"from\":{\"platform\":\"android\",\"device_model\":null},"
        + "\"to\":{\"platform\":\"ios\",\"device_model\":\"iPhone\"},\"gap_days\":3}}}");
    com.clikgate.model.DeviceChange change = new WebhookEvent(dc).asDeviceChange();
    assertEquals("ios", change.getTo().getPlatform());
    assertEquals(Integer.valueOf(3), change.getGapDays());
    assertTrue(EventType.ALL.contains("payment.verified"));
    String sw;
    switch (ev.getType()) {
      case EventType.REFERRAL_QUALIFIED:
        sw = "q";
        break;
      default:
        sw = "other";
    }
    assertEquals("q", sw);
  }

  @Test
  void typedLinkParamsAndNewLinkMethods() throws Exception {
    String link = "{\"object\":\"link\",\"id\":\"lnk_1\",\"short_url\":\"https://ciz.to/a\",\"domain\":\"ciz.to\",\"slug\":\"a\",\"status\":\"paused\","
        + "\"tags\":[\"promo\"],\"metadata\":{\"seller_id\":\"s1\"},\"deep_link_data\":{\"screen\":\"cart\"},\"attribution_window_days\":30,"
        + "\"urls\":[{\"domain\":\"ciz.to\",\"url\":\"https://ciz.to/a\",\"role\":\"primary\"}],\"expires_at\":null,\"created_at\":\"2026-11-01T00:00:00Z\"}";
    Scripted t = new Scripted().then(201, link).then(200, link).then(200, link).then(200, link).then(200, link).then(200, link);
    Clikgate c = client(t);
    Link l = c.links().create(LinkCreateParams.builder().destinationUrl("https://example.com").slug("a").tags(Arrays.asList("promo")).fallbackUrl(null).build());
    assertEquals("{destination_url=https://example.com, slug=a, tags=[promo]}", String.valueOf(t.body(0)));
    assertEquals("ciz.to", l.getDomain());
    assertEquals(Integer.valueOf(30), l.getAttributionWindowDays());
    assertEquals(Arrays.asList("promo"), l.getTags());
    assertEquals("primary", l.getUrls().get(0).getRole());
    assertEquals("cart", l.getDeepLinkData().get("screen"));
    c.links().update("lnk_1", LinkUpdateParams.builder().destinationUrl("https://example.com/b").fallbackUrl(null).build());
    assertEquals("{destination_url=https://example.com/b, fallback_url=null}", String.valueOf(t.body(1)));
    c.links().archive("lnk_1");
    c.links().getByReference("seller/881");
    c.links().pause("lnk_1");
    c.links().resume("lnk_1");
    assertEquals("DELETE", t.requests.get(2).getMethod());
    assertEquals("/v1/links/by-reference/seller%2F881", t.path(3));
    assertEquals("/v1/links/lnk_1/pause", t.path(4));
    assertEquals("/v1/links/lnk_1/resume", t.path(5));
  }

  @Test
  void peopleInstallsCodesAndPrivacy() throws Exception {
    String person = "{\"object\":\"person\",\"id\":\"per_1\",\"label\":\"Ada (VIP)\",\"customer_user_id\":\"user_42\",\"links\":[],\"can_unmerge\":false}";
    String summary = "{\"object\":\"person_summary\",\"id\":\"per_1\",\"label\":\"Ada\",\"goals\":2,\"goal_value_minor\":{\"NGN\":150000}}";
    String install = "{\"object\":\"install\",\"id\":\"ins_1\",\"app_id\":\"app_1\",\"installation_id\":\"inst_1\",\"customer_user_id\":\"user_42\","
        + "\"link\":{\"id\":\"lnk_1\",\"kind\":\"standard\",\"external_reference\":null,\"campaign_id\":null,\"metadata\":{}},\"person\":{\"id\":\"per_1\"},\"confidence\":0.92}";
    String redemption = "{\"object\":\"code_redemption\",\"offline_touch_id\":\"oft_1\",\"code\":{\"code\":\"ADA42\",\"kind\":\"referral\",\"link_id\":null,"
        + "\"campaign_id\":null,\"referrer_id\":\"rfr_1\",\"program_id\":\"rpg_1\"},\"referral\":null,\"linked\":false,\"referral_error\":{\"code\":\"already_referred\",\"message\":\"x\"}}";
    String privacy = "{\"object\":\"privacy_request\",\"id\":\"prq_1\",\"type\":\"export\",\"subject_type\":\"customer_user\",\"status\":\"completed\","
        + "\"result\":{\"download_url\":\"https://x\",\"expires_at\":1793016000,\"installs\":1,\"goal_name_events\":2},\"error\":null}";
    Scripted t = new Scripted().then(200, person).then(200, page(summary, true, "cur_2")).then(200, page(summary, false, null)).then(200, person)
        .then(200, install).then(200, install).then(201, redemption).then(202, privacy).then(200, privacy);
    Clikgate c = client(t);
    Person p = c.people().get("per_1");
    assertEquals("user_42", p.getCustomerId());
    List<PersonSummary> found = new ArrayList<>();
    for (PersonSummary s : c.people().search("ada")) {
      found.add(s);
    }
    assertEquals(2, found.size());
    assertEquals(Long.valueOf(150000L), found.get(0).getGoalValueMinor().get("NGN"));
    assertEquals("{q=ada}", String.valueOf(t.body(1)));
    assertEquals("{q=ada, cursor=cur_2}", String.valueOf(t.body(2)));
    c.people().setLabel("per_1", "Ada (VIP)");
    assertEquals("PATCH", t.requests.get(3).getMethod());
    assertEquals("{label=Ada (VIP)}", String.valueOf(t.body(3)));
    Install i = c.installs().getByCustomer("user_42");
    assertEquals("/v1/installs/by-customer-user/user_42", t.path(4));
    assertEquals("per_1", i.getPersonId());
    assertEquals("lnk_1", i.getLink().getId());
    c.installs().getByInstallation("inst_1", "app_1");
    assertEquals("/v1/installs/by-installation/inst_1?app_id=app_1", t.path(5));
    CodeRedemption r = c.codes().redeem(RedeemCodeParams.builder().externalId("ussd-1").code("ADA42").channel("ussd").subject("customer_user_id", "user_42").agentId("ag_7").location("NG", null, "Lagos", "st_1").build());
    assertEquals("rpg_1", r.getCode().getProgramId());
    assertNull(r.getReferral());
    assertEquals("already_referred", r.getReferralError().getCode());
    assertEquals("{external_id=ussd-1, code=ADA42, channel=ussd, subject={type=customer_user_id, id=user_42}, agent_id=ag_7, location={country=NG, city=Lagos, store_id=st_1}}", String.valueOf(t.body(6)));
    PrivacyRequest pr = c.privacy().createRequest(CreatePrivacyRequestParams.builder().type("export").subjectType("customer_user").subjectId("user_42").build());
    assertEquals("{type=export, subject_type=customer_user, subject_id=user_42}", String.valueOf(t.body(7)));
    assertEquals("https://x", pr.getExportResult().getDownloadUrl());
    assertTrue(pr.getErasedCounts().isEmpty());
    c.privacy().getRequest("prq_1");
    assertEquals("/v1/privacy/requests/prq_1", t.path(8));
  }
}
