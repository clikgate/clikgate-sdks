using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Xunit;

namespace Clikgate.Tests;

public class TypedSurfaceTests
{
    private const string Key = "cg_test_unit000000000000";

    private const string ReferrerJson =
        "{\"object\":\"referrer\",\"id\":\"rfr_1\",\"program_id\":\"rpg_1\",\"customer_user_id\":\"user_42\",\"display_name\":\"Ada\",\"code\":\"ADA42\","
        + "\"external_code\":null,\"link_id\":\"lnk_1\",\"url\":\"https://ciz.to/r/ADA42\",\"short_url\":\"https://ciz.to/x\",\"status\":\"active\","
        + "\"blocked_reason\":null,\"blocked_at\":null,\"stats\":{\"clicks\":3,\"installs\":2,\"signups\":1,\"in_progress\":1,\"qualified\":1,"
        + "\"disqualified\":0,\"rejected\":0},\"attributes\":{\"tier\":\"gold\"},\"leaderboard_opt_out\":false,\"quality_score\":null,"
        + "\"quality_band\":null,\"last_activity_at\":\"2026-11-01T10:00:00Z\",\"created_at\":\"2026-10-01T10:00:00Z\",\"updated_at\":\"2026-10-02T10:00:00Z\",\"livemode\":false}";

    private const string ReferralJson =
        "{\"object\":\"referral\",\"id\":\"ref_1\",\"program_id\":\"rpg_1\",\"referrer_id\":\"rfr_1\",\"status\":\"qualified\",\"source\":\"link\","
        + "\"match_type\":\"deterministic\",\"current_step\":1,\"steps_completed\":[{\"index\":0,\"goal\":\"first_deposit\",\"completed_at\":\"2026-11-01T10:00:00Z\"}],"
        + "\"step_deadline_at\":null,\"hold_until\":null,\"qualified_at\":\"2026-11-02T10:00:00Z\",\"disqualified_at\":null,\"rejected_at\":null,"
        + "\"reason\":null,\"fraud_flags\":[],\"referee_uninstalled_after_qualification\":false,\"program\":{\"id\":\"rpg_1\",\"name\":\"Invite friends\"},"
        + "\"referrer\":{\"id\":\"rfr_1\",\"customer_user_id\":\"user_42\",\"code\":\"ADA42\"},\"referee\":{\"install_id\":\"ins_1\",\"installation_id\":\"inst_1\","
        + "\"customer_user_id\":\"user_77\"},\"link\":{\"id\":\"lnk_1\"},\"click_id\":\"clk_1\",\"reward_snapshot\":{\"referrer\":{\"amount_minor\":150050,"
        + "\"currency\":\"NGN\",\"description\":\"1,500.50 credit\"},\"referee\":{\"amount_minor\":500,\"currency\":\"JPY\"}},"
        + "\"created_at\":\"2026-10-30T10:00:00Z\",\"updated_at\":\"2026-11-02T10:00:00Z\",\"livemode\":false}";

    private sealed class Clock : IClikgateClock
    {
        public long NowMilliseconds() => DateTimeOffset.Parse("2026-11-21T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture).ToUnixTimeMilliseconds();

        public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken) => Task.CompletedTask;
    }

    /// <summary>Answers from a queue and records every request.</summary>
    private sealed class Scripted : HttpMessageHandler
    {
        private readonly Queue<(int Status, string Body)> _answers = new();

        public List<(HttpRequestMessage Request, string? Body)> Requests { get; } = [];

        public Scripted Then(int status, string body)
        {
            _answers.Enqueue((status, body));
            return this;
        }

        public string Path(int i) => Requests[i].Request.RequestUri!.PathAndQuery;

        public string? Body(int i) => Requests[i].Body;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
#if NET472
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync().ConfigureAwait(false);
#else
            var body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
#endif
            Requests.Add((request, body));
            var (status, text) = _answers.Count > 0 ? _answers.Dequeue() : (500, "{}");
            return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(text, Encoding.UTF8, "application/json") };
        }
    }

    private static ClikgateClient Client(Scripted s) => new(new ClikgateOptions
    {
        ApiKey = Key,
        HttpClient = new HttpClient(s),
        PrivateMode = PrivateMode.Off,
        MaxRetries = 0,
        ShutdownHooks = false,
        Clock = new Clock(),
    });

    private static string Page(string item, bool hasMore, string? next) =>
        "{\"object\":\"list\",\"data\":[" + item + "],\"has_more\":" + (hasMore ? "true" : "false") + ",\"next_cursor\":" + (next is null ? "null" : "\"" + next + "\"") + "}";

    [Fact]
    public async Task GetOrCreateReferrer_reads_the_typed_referrer_and_the_created_flag()
    {
        var s = new Scripted().Then(201, ReferrerJson).Then(200, ReferrerJson);
        await using var c = Client(s);
        var r = await c.Referrals.GetOrCreateReferrerAsync("rpg_1", new GetOrCreateReferrerParams { CustomerId = "user_42", DisplayName = "Ada", Code = "ADA42" });
        Assert.True(r.Created);
        Assert.Equal("user_42", r.CustomerId);
        Assert.Equal(3, r.Stats.Clicks);
        Assert.Equal(1, r.Stats.InProgress);
        Assert.Equal("gold", (string?)r.Attributes["tier"]);
        Assert.Equal(DateTimeOffset.Parse("2026-10-01T10:00:00Z", System.Globalization.CultureInfo.InvariantCulture), r.CreatedAt);
        Assert.Equal("/v1/referral-programs/rpg_1/referrers", s.Path(0));
        Assert.Equal("{\"customer_user_id\":\"user_42\",\"code\":\"ADA42\",\"display_name\":\"Ada\"}", s.Body(0));
        Assert.Null(r.Stats.RefereeUninstallRate7d);
        var again = await c.Referrals.GetOrCreateReferrerAsync("rpg_1", "user_42");
        Assert.False(again.Created);
        Assert.Equal(new Referrer(JsonNode.Parse(ReferrerJson) as JsonObject), again);
        await Assert.ThrowsAsync<InvalidRequestException>(() => c.Referrals.GetOrCreateReferrerAsync("rpg_1", new GetOrCreateReferrerParams()));
    }

    [Fact]
    public async Task FindReferrer_is_null_on_404_and_other_calls_throw()
    {
        const string NotFound = "{\"error\":{\"type\":\"not_found\",\"code\":\"referrer_not_found\",\"message\":\"No referrer.\"}}";
        var s = new Scripted().Then(404, NotFound).Then(200, ReferrerJson).Then(404, NotFound);
        await using var c = Client(s);
        Assert.Null(await c.Referrals.FindReferrerAsync("rpg_1", new FindReferrerParams { CustomerId = "user 9" }));
        Assert.Equal("/v1/referral-programs/rpg_1/referrers/by-user/user%209", s.Path(0));
        Assert.Equal("rfr_1", (await c.Referrals.FindReferrerAsync("rpg_1", new FindReferrerParams { Code = "ADA42" }))!.Id);
        Assert.Equal("/v1/referral-programs/rpg_1/referrers/by-code/ADA42", s.Path(1));
        await Assert.ThrowsAsync<NotFoundException>(() => c.Referrals.GetReferrerAsync("rfr_x"));
    }

    [Fact]
    public async Task Referral_reads_nested_objects_and_money()
    {
        await using var c = Client(new Scripted().Then(200, ReferralJson));
        var r = await c.Referrals.GetAsync("ref_1");
        Assert.Equal("Invite friends", r.Program!.Name);
        Assert.Equal("user_42", r.Referrer!.CustomerId);
        Assert.Equal("user_77", r.Referee!.CustomerId);
        Assert.Equal("lnk_1", r.LinkId);
        Assert.Equal("first_deposit", r.StepsCompleted[0].Goal);
        Assert.Equal(150050L, r.Reward!.Referrer!.AmountMinor);
        Assert.Equal("1500.50", r.Reward.Referrer.Amount!.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.Equal(500m, r.Reward.Referee!.Amount);
        Assert.Null(r.Reward.Note);
    }

    [Fact]
    public async Task List_pages_lazily_with_the_cursor()
    {
        var s = new Scripted().Then(200, Page(ReferralJson, true, "ref_1")).Then(200, Page(ReferralJson, false, null));
        await using var c = Client(s);
        var all = new List<Referral>();
        await foreach (var r in c.Referrals.ListAsync(new ListReferralsParams { ProgramId = "rpg_1", RefereeCustomerId = "user_77", Limit = 1 }))
        {
            all.Add(r);
        }
        Assert.Equal(2, all.Count);
        Assert.Equal("/v1/referrals?program_id=rpg_1&referee_customer_user_id=user_77&limit=1", s.Path(0));
        Assert.Equal("/v1/referrals?program_id=rpg_1&referee_customer_user_id=user_77&limit=1&starting_after=ref_1", s.Path(1));
    }

    [Fact]
    public async Task Overrides_steps_block_and_update()
    {
        var s = new Scripted().Then(200, ReferralJson).Then(200, ReferralJson).Then(200, ReferrerJson).Then(200, ReferrerJson).Then(200, ReferrerJson).Then(200, ReferrerJson);
        await using var c = Client(s);
        await c.Referrals.QualifyAsync("ref_1", "ticket 812");
        await c.Referrals.CompleteStepAsync("ref_1", new CompleteStepParams { Goal = "first_deposit", OccurredAt = DateTimeOffset.Parse("2026-11-21T12:00:00Z", System.Globalization.CultureInfo.InvariantCulture), Value = 15000.50m, Currency = "NGN" });
        await c.Referrals.BlockReferrerAsync("rfr_1", "self-referrals");
        await c.Referrals.BlockReferrerAsync("rfr_1");
        await c.Referrals.UnblockReferrerAsync("rfr_1");
        await c.Referrals.UpdateReferrerAsync("rfr_1", new UpdateReferrerParams { ClearDisplayName = true, ExternalCode = "ADA-OLD", LeaderboardOptOut = true, Attributes = new Dictionary<string, object?> { ["tier"] = "gold" } });
        Assert.Equal("{\"action\":\"qualify\",\"reason\":\"ticket 812\"}", s.Body(0));
        Assert.Equal("{\"goal\":\"first_deposit\",\"occurred_at\":\"2026-11-21T12:00:00Z\",\"value\":\"15000.50\",\"currency\":\"NGN\"}", s.Body(1));
        Assert.Equal("{\"reason\":\"self-referrals\"}", s.Body(2));
        var missing = await Assert.ThrowsAsync<InvalidRequestException>(() => c.Referrals.CompleteStepAsync("ref_1", new CompleteStepParams { Goal = "first_deposit" }));
        Assert.Equal("occurred_at", missing.Param);
        Assert.Equal("{}", s.Body(3));
        Assert.Equal("/v1/referrers/rfr_1/unblock", s.Path(4));
        Assert.Equal("{\"display_name\":null,\"external_code\":\"ADA-OLD\",\"leaderboard_opt_out\":true,\"attributes\":{\"tier\":\"gold\"}}", s.Body(5));
        var goal = new GoalEvent(JsonNode.Parse("{\"object\":\"goal_event\",\"link\":{\"id\":\"lnk_1\"},\"campaign\":{\"id\":\"cmp_1\"}}") as JsonObject);
        Assert.Equal("lnk_1", goal.LinkId);
        Assert.Equal("cmp_1", goal.CampaignId);
        var answer = new GoalEvent(JsonNode.Parse("{\"object\":\"goal_event\",\"attributed_to\":{\"link_id\":\"lnk_2\",\"campaign_id\":null}}") as JsonObject);
        Assert.Equal("lnk_2", answer.LinkId);
        Assert.Null(answer.CampaignId);
    }

    [Fact]
    public async Task ImportReferrers_splits_into_batches_of_1000()
    {
        const string Job = "{\"object\":\"job\",\"id\":\"job_1\",\"type\":\"referrer_import\",\"status\":\"queued\",\"total\":1000,\"succeeded\":0,\"failed\":0,"
            + "\"results\":[{\"index\":0,\"ok\":true,\"referrer_id\":\"rfr_1\",\"created\":true}],\"created_at\":\"2026-11-21T12:00:00Z\",\"finished_at\":null}";
        var s = new Scripted().Then(202, Job).Then(202, Job).Then(202, Job);
        await using var c = Client(s);
        var rows = Enumerable.Range(0, 2500).Select(i => new ReferrerImport { CustomerId = "user_" + i }).ToList();
        var jobs = await c.Referrals.ImportReferrersAsync("rpg_1", rows, new RequestOptions { IdempotencyKey = "imp-1" });
        Assert.Equal(3, jobs.Count);
        Assert.Equal(1000, ((JsonArray)JsonNode.Parse(s.Body(0)!)!["referrers"]!).Count);
        Assert.Equal(500, ((JsonArray)JsonNode.Parse(s.Body(2)!)!["referrers"]!).Count);
        Assert.Equal("imp-1", s.Requests[0].Request.Headers.GetValues("Idempotency-Key").Single());
        Assert.Equal("imp-1:2", s.Requests[2].Request.Headers.GetValues("Idempotency-Key").Single());
        Assert.Equal("rfr_1", jobs[0].Results[0].ReferrerId);
        Assert.True(jobs[0].Results[0].Created);
    }

    [Fact]
    public void Webhook_accessors_read_the_typed_object()
    {
        var raw = JsonNode.Parse("{\"id\":\"evt_1\",\"object\":\"event\",\"type\":\"referral.qualified\",\"api_version\":\"2026-10-01\","
            + "\"created_at\":\"2026-11-02T10:00:00Z\",\"organization_id\":\"org_1\",\"livemode\":true,\"data\":{\"object\":" + ReferralJson + ",\"previous_attributes\":null}}") as JsonObject;
        var ev = new WebhookEvent(raw);
        Assert.Equal(EventType.REFERRAL_QUALIFIED, ev.Type);
        Assert.Equal("org_1", ev.OrganizationId);
        Assert.Equal("ref_1", ev.AsReferral()!.Id);
        Assert.Null(ev.AsReferrer());
        Assert.Null(ev.AsPayment());
        Assert.Contains("payment.verified", EventType.All);
        var hit = ev.Type switch
        {
            EventType.REFERRAL_QUALIFIED => "q",
            _ => "other",
        };
        Assert.Equal("q", hit);
    }

    [Fact]
    public async Task Typed_link_params_and_new_link_methods()
    {
        const string LinkJson = "{\"object\":\"link\",\"id\":\"lnk_1\",\"short_url\":\"https://ciz.to/a\",\"domain\":\"ciz.to\",\"slug\":\"a\",\"status\":\"paused\","
            + "\"tags\":[\"promo\"],\"metadata\":{\"seller_id\":\"s1\"},\"deep_link_data\":{\"screen\":\"cart\"},\"attribution_window_days\":30,\"expires_at\":null}";
        var s = new Scripted();
        for (var i = 0; i < 6; i++)
        {
            s.Then(200, LinkJson);
        }
        await using var c = Client(s);
        var link = await c.Links.CreateAsync(new LinkCreateParams { DestinationUrl = "https://example.com", Slug = "a", Tags = ["promo"], FallbackUrl = null });
        Assert.Equal("{\"destination_url\":\"https://example.com\",\"slug\":\"a\",\"tags\":[\"promo\"]}", s.Body(0));
        Assert.Equal("ciz.to", link.Domain);
        Assert.Equal(30, link.AttributionWindowDays);
        Assert.Equal(["promo"], link.Tags);
        Assert.Equal("cart", (string?)link.DeepLinkData["screen"]);
        await c.Links.UpdateAsync("lnk_1", new LinkUpdateParams { DestinationUrl = "https://example.com/b", FallbackUrl = null });
        Assert.Equal("{\"destination_url\":\"https://example.com/b\",\"fallback_url\":null}", s.Body(1));
        await c.Links.ArchiveAsync("lnk_1");
        await c.Links.GetByReferenceAsync("seller/881");
        await c.Links.PauseAsync("lnk_1");
        await c.Links.ResumeAsync("lnk_1");
        Assert.Equal(HttpMethod.Delete, s.Requests[2].Request.Method);
        Assert.Equal("/v1/links/by-reference/seller%2F881", s.Path(3));
        Assert.Equal("/v1/links/lnk_1/pause", s.Path(4));
        Assert.Equal("/v1/links/lnk_1/resume", s.Path(5));
        var p = new LinkUpdateParams { Title = "a" };
        var q = p with { OgTitle = "b" };
        Assert.Equal("{\"title\":\"a\"}", p.ToString());
        Assert.Equal("{\"title\":\"a\",\"og_title\":\"b\"}", q.ToString());
    }

    [Fact]
    public async Task People_installs_codes_and_privacy()
    {
        const string PersonJson = "{\"object\":\"person\",\"id\":\"per_1\",\"label\":\"Ada (VIP)\",\"customer_user_id\":\"user_42\",\"links\":[],\"can_unmerge\":false}";
        const string Summary = "{\"object\":\"person_summary\",\"id\":\"per_1\",\"label\":\"Ada\",\"goals\":2,\"goal_value_minor\":{\"NGN\":150000}}";
        const string InstallJson = "{\"object\":\"install\",\"id\":\"ins_1\",\"app_id\":\"app_1\",\"installation_id\":\"inst_1\",\"customer_user_id\":\"user_42\","
            + "\"link\":{\"id\":\"lnk_1\",\"kind\":\"standard\",\"external_reference\":null,\"campaign_id\":null,\"metadata\":{}},\"person\":{\"id\":\"per_1\"},\"confidence\":0.92}";
        const string Redemption = "{\"object\":\"code_redemption\",\"offline_touch_id\":\"oft_1\",\"code\":{\"code\":\"ADA42\",\"kind\":\"referral\",\"link_id\":null,"
            + "\"campaign_id\":null,\"referrer_id\":\"rfr_1\",\"program_id\":\"rpg_1\"},\"referral\":null,\"linked\":false,\"referral_error\":{\"code\":\"already_referred\",\"message\":\"x\"}}";
        const string PrivacyJson = "{\"object\":\"privacy_request\",\"id\":\"prq_1\",\"type\":\"erasure\",\"subject_type\":\"customer_user\",\"status\":\"completed\","
            + "\"result\":{\"installs\":2,\"goal_events\":5},\"error\":null}";
        var s = new Scripted().Then(200, PersonJson).Then(200, Page(Summary, true, "cur_2")).Then(200, Page(Summary, false, null)).Then(200, PersonJson)
            .Then(200, InstallJson).Then(200, InstallJson).Then(201, Redemption).Then(202, PrivacyJson).Then(200, PrivacyJson);
        await using var c = Client(s);
        Assert.Equal("user_42", (await c.People.GetAsync("per_1")).CustomerId);
        var found = new List<PersonSummary>();
        await foreach (var p in c.People.SearchAsync("ada"))
        {
            found.Add(p);
        }
        Assert.Equal(2, found.Count);
        Assert.Equal(150000L, found[0].GoalValueMinor["NGN"]);
        Assert.Equal("{\"q\":\"ada\"}", s.Body(1));
        Assert.Equal("{\"q\":\"ada\",\"cursor\":\"cur_2\"}", s.Body(2));
        await c.People.SetLabelAsync("per_1", "Ada (VIP)");
        Assert.Equal(new HttpMethod("PATCH"), s.Requests[3].Request.Method);
        var install = await c.Installs.GetByCustomerAsync("user_42");
        Assert.Equal("/v1/installs/by-customer-user/user_42", s.Path(4));
        Assert.Equal("per_1", install.PersonId);
        Assert.Equal(0.92, install.Confidence);
        await c.Installs.GetByInstallationAsync("inst_1", "app_1");
        Assert.Equal("/v1/installs/by-installation/inst_1?app_id=app_1", s.Path(5));
        var r = await c.Codes.RedeemAsync(new RedeemCodeParams { ExternalId = "ussd-1", Code = "ADA42", Channel = "ussd", Subject = new OfflineSubject { Type = "customer_user_id", Id = "user_42" }, AgentId = "ag_7", Location = new OfflineLocation { Country = "NG", City = "Lagos" } });
        Assert.Equal("rpg_1", r.Code!.ProgramId);
        Assert.Null(r.Referral);
        Assert.Equal("already_referred", r.ReferralError!.Code);
        Assert.Equal("{\"external_id\":\"ussd-1\",\"code\":\"ADA42\",\"channel\":\"ussd\",\"subject\":{\"type\":\"customer_user_id\",\"id\":\"user_42\"},\"agent_id\":\"ag_7\",\"location\":{\"country\":\"NG\",\"city\":\"Lagos\"}}", s.Body(6));
        var pr = await c.Privacy.CreateRequestAsync(new CreatePrivacyRequestParams { Type = "erasure", SubjectType = "customer_user", SubjectId = "user_42" });
        Assert.Equal("{\"type\":\"erasure\",\"subject_type\":\"customer_user\",\"subject_id\":\"user_42\"}", s.Body(7));
        Assert.Null(pr.ExportResult);
        Assert.Equal(5L, pr.ErasedCounts["goal_events"]);
        await c.Privacy.GetRequestAsync("prq_1");
        Assert.Equal("/v1/privacy/requests/prq_1", s.Path(8));
    }
}
