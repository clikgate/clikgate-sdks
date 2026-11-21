using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>
/// A typed record over a wire object (the API's JSON, <c>snake_case</c> keys). <see cref="Raw"/> keeps every field,
/// including ones this SDK version doesn't know yet. Two records are equal when their JSON is equal.
/// </summary>
public abstract record WireRecord
{
    /// <summary>Wraps a JSON object.</summary>
    protected WireRecord(JsonObject? raw) => Raw = raw ?? new JsonObject();

    /// <summary>Every field, as the API sent it.</summary>
    public JsonObject Raw { get; }

    /// <summary>One string field.</summary>
    protected string? Str(string key) => Json.Str(Raw[key]);

    /// <summary>One boolean field.</summary>
    protected bool? Bool(string key) => Json.Bool(Raw[key]);

    /// <summary>One whole-number field.</summary>
    protected long? Long(string key)
    {
        if (Raw[key] is not JsonValue v)
        {
            return null;
        }
        if (v.TryGetValue(out long l))
        {
            return l;
        }
        if (v.TryGetValue(out int i))
        {
            return i;
        }
        if (v.TryGetValue(out decimal d))
        {
            return (long)d;
        }
        if (v.TryGetValue(out JsonElement e) && e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out var el))
        {
            return el;
        }
        return null;
    }

    /// <summary>One number field.</summary>
    protected double? Double(string key)
    {
        if (Raw[key] is not JsonValue v)
        {
            return null;
        }
        if (v.TryGetValue(out double d))
        {
            return d;
        }
        if (v.TryGetValue(out long l))
        {
            return l;
        }
        if (v.TryGetValue(out JsonElement e) && e.ValueKind == JsonValueKind.Number)
        {
            return e.GetDouble();
        }
        return null;
    }

    /// <summary>One RFC 3339 timestamp field, or null.</summary>
    protected DateTimeOffset? Time(string key) =>
        Str(key) is string s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) ? t : null;

    /// <summary>A list of strings.</summary>
    protected IReadOnlyList<string> Strings(string key) => (Raw[key] as JsonArray ?? []).Select(Json.Str).OfType<string>().ToList();

    /// <summary>A nested object, or null.</summary>
    protected T? Object<T>(string key, Func<JsonObject, T> make)
        where T : class => Raw[key] is JsonObject o ? make(o) : null;

    /// <summary>A list of nested objects.</summary>
    protected IReadOnlyList<T> Objects<T>(string key, Func<JsonObject, T> make) => (Raw[key] as JsonArray ?? []).OfType<JsonObject>().Select(make).ToList();

    /// <summary>A map of whole numbers.</summary>
    protected IReadOnlyDictionary<string, long> Longs(string key)
    {
        var o = new Dictionary<string, long>(StringComparer.Ordinal);
        if (Raw[key] is JsonObject m)
        {
            foreach (var kv in m)
            {
                if (kv.Value is JsonValue v && v.TryGetValue(out long l))
                {
                    o[kv.Key] = l;
                }
            }
        }
        return o;
    }

    /// <inheritdoc/>
    public virtual bool Equals(WireRecord? other) => other is not null && other.GetType() == GetType() && JsonNode.DeepEquals(Raw, other.Raw);

    /// <inheritdoc/>
    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(Raw.ToJsonString());

    /// <inheritdoc/>
    public sealed override string ToString() => Raw.ToJsonString();
}

/// <summary>A referrer: a customer with a referral code and link in a program (<c>/v1/referrers</c>, <c>referrer.*</c> webhooks).</summary>
public sealed record Referrer : WireRecord
{
    /// <summary>Wraps a referrer object.</summary>
    public Referrer(JsonObject? raw, bool created = false)
        : base(raw) => Created = created;

    /// <summary>True when <c>GetOrCreateReferrerAsync</c> created it (the API answered <c>201</c>); false otherwise.</summary>
    public bool Created { get; }

    /// <summary>The referrer ID (<c>rfr_…</c>).</summary>
    public string? Id => Str("id");

    /// <summary>The program.</summary>
    public string? ProgramId => Str("program_id");

    /// <summary>Your user ID for this customer (wire <c>customer_user_id</c>).</summary>
    public string? CustomerId => Str("customer_user_id");

    /// <summary>The name shown to the people they refer.</summary>
    public string? DisplayName => Str("display_name");

    /// <summary>The referral code people type or share.</summary>
    public string? Code => Str("code");

    /// <summary>Your own code for this referrer, else null.</summary>
    public string? ExternalCode => Str("external_code");

    /// <summary>The referrer's link, else null.</summary>
    public string? LinkId => Str("link_id");

    /// <summary>The URL to share: the code URL, else the short link.</summary>
    public string? Url => Str("url");

    /// <summary>The short link.</summary>
    public string? ShortUrl => Str("short_url");

    /// <summary><c>active</c> or <c>blocked</c>.</summary>
    public string? Status => Str("status");

    /// <summary>Why the referrer was blocked, else null.</summary>
    public string? BlockedReason => Str("blocked_reason");

    /// <summary>When the referrer was blocked, else null.</summary>
    public DateTimeOffset? BlockedAt => Time("blocked_at");

    /// <summary>The referrer's counters, refreshed regularly (not live).</summary>
    public ReferrerStats Stats => Object("stats", o => new ReferrerStats(o)) ?? new ReferrerStats(null);

    /// <summary>Your own keys on this referrer; empty when it has none.</summary>
    public JsonObject Attributes => Raw["attributes"] as JsonObject ?? [];

    /// <summary>True when this referrer is hidden from leaderboards.</summary>
    public bool LeaderboardOptOut => Bool("leaderboard_opt_out") ?? false;

    /// <summary>The last referral activity.</summary>
    public DateTimeOffset? LastActivityAt => Time("last_activity_at");

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Last changed.</summary>
    public DateTimeOffset? UpdatedAt => Time("updated_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>A referrer's counters (<c>stats</c>). Absent counters read as 0.</summary>
public sealed record ReferrerStats : WireRecord
{
    /// <summary>Wraps a stats object.</summary>
    public ReferrerStats(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>Human clicks on the referrer's link.</summary>
    public long Clicks => Long("clicks") ?? 0;

    /// <summary>Referrals of any status.</summary>
    public long Installs => Long("installs") ?? 0;

    /// <summary>Referrals past their first qualification step (rejected ones excluded).</summary>
    public long Signups => Long("signups") ?? 0;

    /// <summary>Open referrals.</summary>
    public long InProgress => Long("in_progress") ?? 0;

    /// <summary>Qualified referrals.</summary>
    public long Qualified => Long("qualified") ?? 0;

    /// <summary>Disqualified referrals.</summary>
    public long Disqualified => Long("disqualified") ?? 0;

    /// <summary>Rejected referrals.</summary>
    public long Rejected => Long("rejected") ?? 0;

    /// <summary>Share of referees (0 to 1) who uninstalled within 7 days; null when none is old enough yet, or not computed yet.</summary>
    public double? RefereeUninstallRate7d => Double("referee_uninstall_rate_7d");
}

/// <summary>A referral (<c>/v1/referrals</c>, <c>referral.*</c> webhooks).</summary>
public sealed record Referral : WireRecord
{
    /// <summary>Wraps a referral object.</summary>
    public Referral(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The referral ID (<c>ref_…</c>).</summary>
    public string? Id => Str("id");

    /// <summary>The program.</summary>
    public string? ProgramId => Str("program_id");

    /// <summary>The referrer.</summary>
    public string? ReferrerId => Str("referrer_id");

    /// <summary><c>in_progress</c>, <c>holding</c>, <c>qualified</c>, <c>disqualified</c>, <c>rejected</c>, … (new statuses can appear).</summary>
    public string? Status => Str("status");

    /// <summary>How the referee arrived: <c>link</c>, <c>code</c>, …</summary>
    public string? Source => Str("source");

    /// <summary>How the install was matched.</summary>
    public string? MatchType => Str("match_type");

    /// <summary>The index of the step the referee is on (0 is the first).</summary>
    public int CurrentStep => (int)(Long("current_step") ?? 0);

    /// <summary>The qualification steps completed, in order.</summary>
    public IReadOnlyList<ReferralStep> StepsCompleted => Objects("steps_completed", o => new ReferralStep(o));

    /// <summary>The current step's deadline, else null.</summary>
    public DateTimeOffset? StepDeadlineAt => Time("step_deadline_at");

    /// <summary>When the hold ends, else null.</summary>
    public DateTimeOffset? HoldUntil => Time("hold_until");

    /// <summary>When it qualified, else null.</summary>
    public DateTimeOffset? QualifiedAt => Time("qualified_at");

    /// <summary>When it was disqualified, else null.</summary>
    public DateTimeOffset? DisqualifiedAt => Time("disqualified_at");

    /// <summary>When it was rejected, else null.</summary>
    public DateTimeOffset? RejectedAt => Time("rejected_at");

    /// <summary>Why it was disqualified or rejected, else null.</summary>
    public string? Reason => Str("reason");

    /// <summary>The evidence of an <c>existing_user</c> rejection, else null.</summary>
    public string? ReasonDetail => Str("reason_detail");

    /// <summary><see cref="ReasonDetail"/> in words, else null.</summary>
    public string? ReasonMessage => Str("reason_message");

    /// <summary>Fraud signals on this referral; empty when none.</summary>
    public IReadOnlyList<string> FraudFlags => Strings("fraud_flags");

    /// <summary>The referral's status changes, oldest first, when the API includes them; empty otherwise.</summary>
    public IReadOnlyList<ReferralStateChange> History => Objects("history", o => new ReferralStateChange(o));

    /// <summary>True when the referee uninstalled the app after the referral qualified (it stays qualified).</summary>
    public bool RefereeUninstalledAfterQualification => Bool("referee_uninstalled_after_qualification") ?? false;

    /// <summary>The program (<c>id</c>, <c>name</c>).</summary>
    public ReferralProgramRef? Program => Object("program", o => new ReferralProgramRef(o));

    /// <summary>The referrer (<c>id</c>, customer ID, <c>code</c>).</summary>
    public ReferralReferrerRef? Referrer => Object("referrer", o => new ReferralReferrerRef(o));

    /// <summary>The person who was referred.</summary>
    public ReferralReferee? Referee => Object("referee", o => new ReferralReferee(o));

    /// <summary>The link the referee came through (wire <c>link.id</c>), else null.</summary>
    public string? LinkId => Raw["link"] is JsonObject l ? Json.Str(l["id"]) : null;

    /// <summary>The click.</summary>
    public string? ClickId => Str("click_id");

    /// <summary>The program's reward when the referral qualified (wire <c>reward_snapshot</c>); null when there was none.</summary>
    public RewardInfo? Reward => Object("reward_snapshot", o => new RewardInfo(o));

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Last changed.</summary>
    public DateTimeOffset? UpdatedAt => Time("updated_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>One status change of a referral.</summary>
public sealed record ReferralStateChange : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public ReferralStateChange(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The earlier status; null for the first.</summary>
    public string? FromStatus => Str("from_status");

    /// <summary>The new status.</summary>
    public string? ToStatus => Str("to_status");

    /// <summary>Why, or null.</summary>
    public string? Reason => Str("reason");

    /// <summary>Who made the change: <c>system</c>, <c>api_key</c>, <c>user</c>, …</summary>
    public string? Actor => Str("actor");

    /// <summary>When.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");
}

/// <summary>A referral's program.</summary>
public sealed record ReferralProgramRef : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public ReferralProgramRef(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The program ID.</summary>
    public string? Id => Str("id");

    /// <summary>The program's name.</summary>
    public string? Name => Str("name");
}

/// <summary>A referral's referrer.</summary>
public sealed record ReferralReferrerRef : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public ReferralReferrerRef(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The referrer ID.</summary>
    public string? Id => Str("id");

    /// <summary>Your user ID for the referrer (wire <c>customer_user_id</c>).</summary>
    public string? CustomerId => Str("customer_user_id");

    /// <summary>The referral code.</summary>
    public string? Code => Str("code");
}

/// <summary>The person who was referred.</summary>
public sealed record ReferralReferee : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public ReferralReferee(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The install.</summary>
    public string? InstallId => Str("install_id");

    /// <summary>The mobile SDK's installation ID.</summary>
    public string? InstallationId => Str("installation_id");

    /// <summary>Your user ID for the referee (wire <c>customer_user_id</c>), once known.</summary>
    public string? CustomerId => Str("customer_user_id");
}

/// <summary>A qualification step the referee completed.</summary>
public sealed record ReferralStep : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public ReferralStep(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The step's position (0 is the first).</summary>
    public int Index => (int)(Long("index") ?? 0);

    /// <summary>The step's goal key; null for an identify step.</summary>
    public string? Goal => Str("goal");

    /// <summary>True for an identify step.</summary>
    public bool Identify => Bool("identify") ?? false;

    /// <summary>When it was completed.</summary>
    public DateTimeOffset? CompletedAt => Time("completed_at");

    /// <summary>What completed it: <c>goal:&lt;goal event id&gt;</c> or <c>identify:&lt;customer ID&gt;</c>.</summary>
    public string? SourceId => Str("source_id");
}

/// <summary>A referral program's reward, for your records only: Clikgate never pays rewards.</summary>
public sealed record RewardInfo : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public RewardInfo(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>What the referrer gets, or null.</summary>
    public RewardSide? Referrer => Object("referrer", o => new RewardSide(o));

    /// <summary>What the referee gets, or null.</summary>
    public RewardSide? Referee => Object("referee", o => new RewardSide(o));

    /// <summary>A note shown with the reward, or null.</summary>
    public string? Note => Str("note");
}

/// <summary>One side's reward.</summary>
public sealed record RewardSide : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public RewardSide(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The amount in the currency's minor units (kobo, cents), or null.</summary>
    public long? AmountMinor => Long("amount_minor");

    /// <summary><see cref="AmountMinor"/> in normal units (exact, ISO 4217 decimals), or null.</summary>
    public decimal? Amount => Currencies.ToNormalUnits(AmountMinor, Currency);

    /// <summary>ISO 4217, present with the amount.</summary>
    public string? Currency => Str("currency");

    /// <summary>The reward in words, or null.</summary>
    public string? Description => Str("description");
}

/// <summary>A background job (<c>/v1/jobs</c>), e.g. a referrer import.</summary>
public sealed record Job : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public Job(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The job ID (<c>job_…</c>).</summary>
    public string? Id => Str("id");

    /// <summary>The job type.</summary>
    public string? Type => Str("type");

    /// <summary><c>queued</c>, <c>running</c>, <c>succeeded</c>, <c>failed</c>, …</summary>
    public string? Status => Str("status");

    /// <summary>Items in the job.</summary>
    public long Total => Long("total") ?? 0;

    /// <summary>Items that succeeded.</summary>
    public long Succeeded => Long("succeeded") ?? 0;

    /// <summary>Items that failed.</summary>
    public long Failed => Long("failed") ?? 0;

    /// <summary>One entry per input item, or the file of an export.</summary>
    public IReadOnlyList<JobResult> Results => Objects("results", o => new JobResult(o));

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Finished, else null.</summary>
    public DateTimeOffset? FinishedAt => Time("finished_at");
}

/// <summary>One result of a job. Only the keys that apply are set.</summary>
public sealed record JobResult : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public JobResult(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The input item's position (0 is the first), or null.</summary>
    public int? Index => Long("index") is long l ? (int)l : null;

    /// <summary>Whether the input item succeeded, or null.</summary>
    public bool? Ok => Bool("ok");

    /// <summary>Referrer imports: the referrer.</summary>
    public string? ReferrerId => Str("referrer_id");

    /// <summary>Referrer imports: true when the referrer is new, false when updated.</summary>
    public bool? Created => Bool("created");

    /// <summary>Bulk link jobs: the link created or changed.</summary>
    public string? LinkId => Str("link_id");

    /// <summary>Exports and downloads: a signed link to the file.</summary>
    public string? Url => Str("url");

    /// <summary>When <see cref="Url"/> stops working (Unix seconds).</summary>
    public long? ExpiresAt => Long("expires_at");

    /// <summary>Exports: the rows in the file.</summary>
    public long? Rows => Long("rows");

    /// <summary>QR placement downloads: the images in the ZIP.</summary>
    public long? Files => Long("files");

    /// <summary>Report exports: the report run exported.</summary>
    public string? RunId => Str("run_id");

    /// <summary>Test data resets: the kind of data deleted.</summary>
    public string? Table => Str("table");

    /// <summary>Test data resets: how many rows were deleted.</summary>
    public long? Deleted => Long("deleted");

    /// <summary>Why the item or job failed, or null.</summary>
    public JobResultError? Error => Object("error", o => new JobResultError(o));
}

/// <summary>Why a job item failed.</summary>
public sealed record JobResultError : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public JobResultError(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary><c>invalid_request</c> or <c>server</c>.</summary>
    public string? Type => Str("type");

    /// <summary>The error code.</summary>
    public string? Code => Str("code");

    /// <summary>What went wrong.</summary>
    public string? Message => Str("message");

    /// <summary>The field of the item that was refused, or null.</summary>
    public string? Param => Str("param");

    /// <summary>QR placement downloads: the placement left out, or null.</summary>
    public long? Number => Long("number");

    /// <summary>QR placement downloads: why it was left out; empty otherwise.</summary>
    public IReadOnlyList<string> Reasons => Strings("reasons");
}

/// <summary>One page of a list: <c>data</c>, <c>has_more</c>, <c>next_cursor</c>.</summary>
/// <typeparam name="T">The item type.</typeparam>
public sealed record Page<T> : WireRecord
{
    /// <summary>Wraps a page, reading each item with <paramref name="make"/>.</summary>
    public Page(JsonObject? raw, Func<JsonObject, T> make)
        : base(raw) => Data = Objects("data", make ?? throw new ArgumentNullException(nameof(make)));

    /// <summary>This page's items.</summary>
    public IReadOnlyList<T> Data { get; }

    /// <summary>True when another page follows.</summary>
    public bool HasMore => Bool("has_more") ?? false;

    /// <summary>The next page's cursor; null on the last page.</summary>
    public string? NextCursor => Str("next_cursor");

    /// <inheritdoc/>
    public bool Equals(Page<T>? other) => base.Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => base.GetHashCode();
}

/// <summary>A privacy request for one data subject (<c>/v1/privacy/requests</c>).</summary>
public sealed record PrivacyRequest : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public PrivacyRequest(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The request ID.</summary>
    public string? Id => Str("id");

    /// <summary>The app, for an installation subject.</summary>
    public string? AppId => Str("app_id");

    /// <summary><c>access</c>, <c>export</c>, <c>delete</c> or <c>erasure</c>.</summary>
    public string? Type => Str("type");

    /// <summary><c>installation</c>, <c>customer_user</c>, <c>email</c>, <c>phone</c>, <c>person</c> or <c>click</c>.</summary>
    public string? SubjectType => Str("subject_type");

    /// <summary><c>pending</c>, <c>processing</c>, <c>completed</c> or <c>failed</c>.</summary>
    public string? Status => Str("status");

    /// <summary>The result as the API sent it; null until the request completes.</summary>
    public JsonObject? Result => Raw["result"] as JsonObject;

    /// <summary>A completed export: the signed link to the subject's data; null otherwise.</summary>
    public PrivacyExportResult? ExportResult => Result is JsonObject r && Json.Str(r["download_url"]) is not null ? new PrivacyExportResult(r) : null;

    /// <summary>A completed erasure: how many records of each kind were erased or anonymised; empty otherwise.</summary>
    public IReadOnlyDictionary<string, long> ErasedCounts => ExportResult is null ? Longs("result") : new Dictionary<string, long>();

    /// <summary>Why it failed, else null.</summary>
    public string? Error => Str("error");

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Completed, else null.</summary>
    public DateTimeOffset? CompletedAt => Time("completed_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>The result of a completed export request.</summary>
public sealed record PrivacyExportResult : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public PrivacyExportResult(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>A signed link to the JSON file with the subject's data.</summary>
    public string? DownloadUrl => Str("download_url");

    /// <summary>When the link stops working (Unix seconds).</summary>
    public long? ExpiresAt => Long("expires_at");

    /// <summary>Installs included.</summary>
    public long Installs => Long("installs") ?? 0;

    /// <summary>Goal events included.</summary>
    public long GoalNameEvents => Long("goal_name_events") ?? 0;
}

/// <summary>A person: everything Clikgate knows belongs to one customer (<c>/v1/people</c>).</summary>
public sealed record Person : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public Person(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The person ID (<c>per_…</c>).</summary>
    public string? Id => Str("id");

    /// <summary>What your team sees instead of the click ID, or null.</summary>
    public string? Label => Str("label");

    /// <summary>Who set the label.</summary>
    public string? LabelSource => Str("label_source");

    /// <summary>When the label was set.</summary>
    public DateTimeOffset? LabelUpdatedAt => Time("label_updated_at");

    /// <summary>Your user ID for this person (wire <c>customer_user_id</c>), or null.</summary>
    public string? CustomerId => Str("customer_user_id");

    /// <summary>The first click ID seen for this person, or null.</summary>
    public string? ClickId => Str("click_id");

    /// <summary>The person this one was merged into, or null.</summary>
    public string? MergedInto => Str("merged_into");

    /// <summary>Whether a merge can be undone.</summary>
    public bool CanUnmerge => Bool("can_unmerge") ?? false;

    /// <summary>The person's clicks, installs and identifiers (<c>links</c>), as the API sent them.</summary>
    public IReadOnlyList<JsonObject> Links => (Raw["links"] as JsonArray ?? []).OfType<JsonObject>().ToList();

    /// <summary>What the person did, newest first (<c>timeline</c>), as the API sent it.</summary>
    public IReadOnlyList<JsonObject> Timeline => (Raw["timeline"] as JsonArray ?? []).OfType<JsonObject>().ToList();

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Last seen.</summary>
    public DateTimeOffset? LastSeenAt => Time("last_seen_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>A person as <c>People.SearchAsync</c> lists them.</summary>
public sealed record PersonSummary : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public PersonSummary(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The person ID (<c>per_…</c>).</summary>
    public string? Id => Str("id");

    /// <summary>The label, or null.</summary>
    public string? Label => Str("label");

    /// <summary>The click ID, or null.</summary>
    public string? ClickId => Str("click_id");

    /// <summary>Your user ID for this person (wire <c>customer_user_id</c>), or null.</summary>
    public string? CustomerId => Str("customer_user_id");

    /// <summary>Last seen.</summary>
    public DateTimeOffset? LastSeenAt => Time("last_seen_at");

    /// <summary>How many goal events the person has.</summary>
    public long Goals => Long("goals") ?? 0;

    /// <summary>The person's goal value per currency, in minor units.</summary>
    public IReadOnlyDictionary<string, long> GoalValueMinor => Longs("goal_value_minor");

    /// <summary>What the search matched: <c>label</c>, <c>customer_id</c> or <c>click_id</c>.</summary>
    public string? MatchedOn => Str("matched_on");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>An app install (<c>/v1/installs</c>, <c>install.*</c> webhooks).</summary>
public sealed record Install : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public Install(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The install ID (<c>ins_…</c>).</summary>
    public string? Id => Str("id");

    /// <summary>The app.</summary>
    public string? AppId => Str("app_id");

    /// <summary>The mobile SDK's installation ID.</summary>
    public string? InstallationId => Str("installation_id");

    /// <summary><c>ios</c> or <c>android</c>.</summary>
    public string? Platform => Str("platform");

    /// <summary>The first app open.</summary>
    public DateTimeOffset? FirstOpenAt => Time("first_open_at");

    /// <summary>The app version.</summary>
    public string? AppVersion => Str("app_version");

    /// <summary>The mobile SDK version.</summary>
    public string? SdkVersion => Str("sdk_version");

    /// <summary>The OS version.</summary>
    public string? OsVersion => Str("os_version");

    /// <summary>The device model.</summary>
    public string? DeviceModel => Str("device_model");

    /// <summary>The country.</summary>
    public string? Country => Str("country");

    /// <summary>True for a reinstall.</summary>
    public bool IsReinstall => Bool("is_reinstall") ?? false;

    /// <summary>The earlier install, for a reinstall.</summary>
    public string? PreviousInstallId => Str("previous_install_id");

    /// <summary><c>attributed</c>, <c>organic</c>, <c>pending</c>, …</summary>
    public string? AttributionStatus => Str("attribution_status");

    /// <summary><c>new</c>, <c>reinstall</c>, <c>new_phone</c>, …</summary>
    public string? InstallKind => Str("install_kind");

    /// <summary>How the install was matched.</summary>
    public string? MatchType => Str("match_type");

    /// <summary>How sure the match is, 0 to 1, or null.</summary>
    public double? Confidence => Double("confidence");

    /// <summary>The click.</summary>
    public string? ClickId => Str("click_id");

    /// <summary>When the click happened.</summary>
    public DateTimeOffset? ClickedAt => Time("clicked_at");

    /// <summary>When the install was attributed.</summary>
    public DateTimeOffset? AttributedAt => Time("attributed_at");

    /// <summary>The link the install is attributed to, or null.</summary>
    public InstallLinkRef? Link => Object("link", o => new InstallLinkRef(o));

    /// <summary>The campaign.</summary>
    public string? CampaignId => Str("campaign_id");

    /// <summary>Fraud flags.</summary>
    public IReadOnlyList<string> FraudFlags => Strings("fraud_flags");

    /// <summary>Your user ID for this install's customer (wire <c>customer_user_id</c>), or null.</summary>
    public string? CustomerId => Str("customer_user_id");

    /// <summary>True when the customer ID came from your server or an identity token.</summary>
    public bool IdentityVerified => Bool("identity_verified") ?? false;

    /// <summary>Last seen.</summary>
    public DateTimeOffset? LastSeenAt => Time("last_seen_at");

    /// <summary><c>installed</c>, <c>uninstalled</c>, …</summary>
    public string? UninstallStatus => Str("uninstall_status");

    /// <summary>When the uninstall was detected.</summary>
    public DateTimeOffset? UninstalledDetectedAt => Time("uninstalled_detected_at");

    /// <summary>The install's person (wire <c>person.id</c>), or null.</summary>
    public string? PersonId => Raw["person"] is JsonObject p ? Json.Str(p["id"]) : null;

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>The link an install is attributed to.</summary>
public sealed record InstallLinkRef : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public InstallLinkRef(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The link ID.</summary>
    public string? Id => Str("id");

    /// <summary>The link kind.</summary>
    public string? Kind => Str("kind");

    /// <summary>Your own ID for the link.</summary>
    public string? ExternalReference => Str("external_reference");

    /// <summary>The campaign.</summary>
    public string? CampaignId => Str("campaign_id");

    /// <summary>The link's own keys (<c>metadata</c>).</summary>
    public JsonObject Metadata => Raw["metadata"] as JsonObject ?? [];
}

/// <summary>The answer of <c>Codes.RedeemAsync</c>: an offline touch, and the referral it created or found.</summary>
public sealed record CodeRedemption : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public CodeRedemption(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The offline touch recorded (<c>oft_…</c>).</summary>
    public string? OfflineTouchId => Str("offline_touch_id");

    /// <summary>The code that was redeemed.</summary>
    public RedeemedCode? Code => Object("code", o => new RedeemedCode(o));

    /// <summary>The referral this redemption created or found, else null.</summary>
    public Referral? Referral => Object("referral", o => new Referral(o));

    /// <summary>True once the touch is tied to an install (now, or later).</summary>
    public bool Linked => Bool("linked") ?? false;

    /// <summary>Why a referral code didn't create a referral (e.g. <c>already_referred</c>), else null.</summary>
    public ReferralError? ReferralError => Object("referral_error", o => new ReferralError(o));

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>A redeemed code and what it belongs to.</summary>
public sealed record RedeemedCode : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public RedeemedCode(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The code.</summary>
    public string? Code => Str("code");

    /// <summary><c>link</c>, <c>campaign</c> or <c>referral</c>.</summary>
    public string? Kind => Str("kind");

    /// <summary>The link.</summary>
    public string? LinkId => Str("link_id");

    /// <summary>The campaign.</summary>
    public string? CampaignId => Str("campaign_id");

    /// <summary>The referrer.</summary>
    public string? ReferrerId => Str("referrer_id");

    /// <summary>The referral program.</summary>
    public string? ProgramId => Str("program_id");
}

/// <summary>Why a referral code didn't create a referral.</summary>
public sealed record ReferralError : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public ReferralError(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The code, e.g. <c>already_referred</c>.</summary>
    public string? Code => Str("code");

    /// <summary>In words.</summary>
    public string? Message => Str("message");
}

/// <summary>A payment report, decided by a trusted confirmation (<c>payment.*</c> webhooks).</summary>
public sealed record PaymentReport : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public PaymentReport(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary>The report ID.</summary>
    public string? Id => Str("id");

    /// <summary>The payment provider (<see cref="global::Clikgate.Provider.FromString"/> accepts newer ones).</summary>
    public global::Clikgate.Provider? Provider => Str("provider") is string p ? global::Clikgate.Provider.FromString(p) : (global::Clikgate.Provider?)null;

    /// <summary>The payment reference (masked in private mode).</summary>
    public string? Reference => Str("reference");

    /// <summary>Who reported the payment: <c>app</c>, <c>web</c>, <c>server</c>, …</summary>
    public string? Source => Str("source");

    /// <summary>The Payment goal.</summary>
    public string? Goal => Str("goal");

    /// <summary><c>pending</c>, <c>verified</c>, <c>rejected</c>, <c>not_confirmed</c>, <c>refunded</c>, …</summary>
    public string? Status => Str("status");

    /// <summary>Why it has this status, else null.</summary>
    public string? StatusReason => Str("status_reason");

    /// <summary>The click.</summary>
    public string? ClickId => Str("click_id");

    /// <summary>The app installation.</summary>
    public string? InstallationId => Str("installation_id");

    /// <summary>The link.</summary>
    public string? LinkId => Str("link_id");

    /// <summary>True when the verified payment counts in totals.</summary>
    public bool Counted => Bool("counted") ?? false;

    /// <summary>The goal event counted for this payment, or null.</summary>
    public string? GoalEventId => Str("goal_event_id");

    /// <summary>How much was refunded, in minor units.</summary>
    public long RefundedAmountMinor => Long("refunded_amount_minor") ?? 0;

    /// <summary>Flags.</summary>
    public IReadOnlyList<string> Flags => Strings("flags");

    /// <summary>When the payment happened.</summary>
    public DateTimeOffset? OccurredAt => Time("occurred_at");

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Decided, else null.</summary>
    public DateTimeOffset? DecidedAt => Time("decided_at");

    /// <summary>When an undecided report expires.</summary>
    public DateTimeOffset? ExpiresAt => Time("expires_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>A customer moving to another phone, or adding one (the <c>person.device_changed</c> webhook, <see cref="WebhookEvent.AsDeviceChange"/>). Coarse device models only.</summary>
public sealed record DeviceChange : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public DeviceChange(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary><c>&lt;device_change_id&gt;:&lt;kind&gt;</c>.</summary>
    public string? Id => Str("id");

    /// <summary>The device change.</summary>
    public string? DeviceChangeId => Str("device_change_id");

    /// <summary>The person (<c>per_…</c>).</summary>
    public string? PersonId => Str("person_id");

    /// <summary>Your user ID for the customer, or null.</summary>
    public string? CustomerId => Str("customer_id");

    /// <summary>The app.</summary>
    public string? AppId => Str("app_id");

    /// <summary><c>switch</c> (moved to another phone) or <c>second_device</c> (added one).</summary>
    public string? Kind => Str("kind");

    /// <summary>The earlier phone.</summary>
    public DeviceChangeSide? From => Object("from", o => new DeviceChangeSide(o));

    /// <summary>The new phone.</summary>
    public DeviceChangeSide? To => Object("to", o => new DeviceChangeSide(o));

    /// <summary>When the earlier phone was last seen, or null.</summary>
    public DateTimeOffset? FromLastSeenAt => Time("from_last_seen_at");

    /// <summary>When the new phone first opened the app.</summary>
    public DateTimeOffset? ToFirstOpenAt => Time("to_first_open_at");

    /// <summary>Days between the two, for a switch; null for a second device.</summary>
    public int? GapDays => Long("gap_days") is long l ? (int)l : null;

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
}

/// <summary>One phone of a <see cref="DeviceChange"/>.</summary>
public sealed record DeviceChangeSide : WireRecord
{
    /// <summary>Wraps the object.</summary>
    public DeviceChangeSide(JsonObject? raw)
        : base(raw)
    {
    }

    /// <summary><c>ios</c> or <c>android</c>.</summary>
    public string? Platform => Str("platform");

    /// <summary>The device model, or null.</summary>
    public string? DeviceModel => Str("device_model");
}
