using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>
/// Referrals: referrers (get or create, find, block, update, import) and referrals (read, list, qualify, disqualify,
/// complete a step). Every method returns a typed record.
/// </summary>
public sealed class Referrals
{
    /// <summary>Rows per import request; longer lists are sent in several requests.</summary>
    public const int ImportBatchSize = 1000;

    private readonly Core _core;

    internal Referrals(Core core) => _core = core;

    private static string Seg(string? value, string name) => Requester.EncodePathSegment(Requester.RequireId(value, name));

    private static string ProgramPath(string programId) => "/v1/referral-programs/" + Seg(programId, "program_id");

    private static string ReferrerPath(string referrerId) => "/v1/referrers/" + Seg(referrerId, "referrer_id");

    private static string ReferralPath(string referralId) => "/v1/referrals/" + Seg(referralId, "referral_id");

    private async Task<(int Status, JsonObject? Data)> CallAsync(ApiRequest req, CancellationToken ct)
    {
        var (status, data, _) = await _core.Requester.RequestAsync(req, ct).ConfigureAwait(false);
        return (status, data as JsonObject);
    }

    private async Task<Referrer> ReferrerAsync(ApiRequest req, CancellationToken ct) => new((await CallAsync(req, ct).ConfigureAwait(false)).Data);

    private async Task<Referral> ReferralAsync(ApiRequest req, CancellationToken ct) => new((await CallAsync(req, ct).ConfigureAwait(false)).Data);

    /// <summary>
    /// The customer's referrer in a program, created on first call (<see cref="Referrer.Created"/> is then true). Call it
    /// when your signed-in user opens "Invite friends".
    /// </summary>
    /// <example><code>var referrer = await clikgate.Referrals.GetOrCreateReferrerAsync("rpg_01J…", new GetOrCreateReferrerParams { CustomerId = user.Id });</code></example>
    public async Task<Referrer> GetOrCreateReferrerAsync(string programId, GetOrCreateReferrerParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        var path = ProgramPath(programId) + "/referrers";
        var (status, data) = await CallAsync(new ApiRequest("POST", path).WithBody(p.Wire()).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Referrer(data, status == 201);
    }

    /// <summary><see cref="GetOrCreateReferrerAsync(string, GetOrCreateReferrerParams, RequestOptions?, CancellationToken)"/> with only your signed-in user's ID.</summary>
    /// <example><code>var referrer = await clikgate.Referrals.GetOrCreateReferrerAsync("rpg_01J…", user.Id);</code></example>
    public Task<Referrer> GetOrCreateReferrerAsync(string programId, string customerId, CancellationToken cancellationToken = default) =>
        GetOrCreateReferrerAsync(programId, new GetOrCreateReferrerParams { CustomerId = customerId }, null, cancellationToken);

    /// <summary>A referrer by ID.</summary>
    /// <example><code>var referrer = await clikgate.Referrals.GetReferrerAsync("rfr_01J…");</code></example>
    public Task<Referrer> GetReferrerAsync(string referrerId, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        ReferrerAsync(new ApiRequest("GET", ReferrerPath(referrerId)).With(requestOptions), cancellationToken);

    /// <summary>A program's referrer by your customer ID or by referral code; null when there is none (a <c>404</c>).</summary>
    /// <example><code>var referrer = await clikgate.Referrals.FindReferrerAsync("rpg_01J…", new FindReferrerParams { Code = "ADA42" });</code></example>
    public async Task<Referrer?> FindReferrerAsync(string programId, FindReferrerParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        if ((p.Code is null) == (p.CustomerId is null))
        {
            throw Errors.Local("invalid_argument", "Give exactly one of CustomerId and Code.", p.Code is null ? "customer_id" : "code");
        }
        var path = p.Code is not null
            ? ProgramPath(programId) + "/referrers/by-code/" + Seg(p.Code, "code")
            : ProgramPath(programId) + "/referrers/by-user/" + Seg(p.CustomerId, "customer_id");
        try
        {
            return await ReferrerAsync(new ApiRequest("GET", path).With(requestOptions), cancellationToken).ConfigureAwait(false);
        }
        catch (NotFoundException)
        {
            return null;
        }
    }

    /// <summary>A referral by ID.</summary>
    /// <example><code>var referral = await clikgate.Referrals.GetAsync("rfl_01J…");</code></example>
    public Task<Referral> GetAsync(string referralId, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        ReferralAsync(new ApiRequest("GET", ReferralPath(referralId)).With(requestOptions), cancellationToken);

    /// <summary>One page of referrals.</summary>
    /// <example><code>var page = await clikgate.Referrals.ListPageAsync(new ListReferralsParams { Status = "qualified" });</code></example>
    public Task<Page<Referral>> ListPageAsync(ListReferralsParams? parameters = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        PageAsync((parameters ?? new ListReferralsParams()).Query(), requestOptions, cancellationToken);

    private async Task<Page<Referral>> PageAsync(Dictionary<string, object?> query, RequestOptions? requestOptions, CancellationToken ct) =>
        new((await CallAsync(new ApiRequest("GET", "/v1/referrals", query).With(requestOptions), ct).ConfigureAwait(false)).Data, o => new Referral(o));

    /// <summary>Every referral matching the filters, fetching pages lazily.</summary>
    /// <example><code>await foreach (var r in clikgate.Referrals.ListAsync(new ListReferralsParams { ProgramId = "rpg_01J…" })) Console.WriteLine(r.Status);</code></example>
    public async IAsyncEnumerable<Referral> ListAsync(ListReferralsParams? parameters = null, RequestOptions? requestOptions = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var baseQuery = (parameters ?? new ListReferralsParams()).Query();
        string? cursor = null;
        while (true)
        {
            var q = new Dictionary<string, object?>(baseQuery);
            if (cursor is not null)
            {
                q["starting_after"] = cursor;
            }
            var page = await PageAsync(q, requestOptions, cancellationToken).ConfigureAwait(false);
            foreach (var r in page.Data)
            {
                yield return r;
            }
            if (!page.HasMore || string.IsNullOrEmpty(page.NextCursor))
            {
                yield break;
            }
            cursor = page.NextCursor;
        }
    }

    /// <summary>Qualifies a referral by hand (audit-logged).</summary>
    /// <example><code>await clikgate.Referrals.QualifyAsync("rfl_01J…", "Verified with support ticket #812");</code></example>
    public Task<Referral> QualifyAsync(string referralId, string reason, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        OverrideAsync(referralId, "qualify", reason, requestOptions, cancellationToken);

    /// <summary>Disqualifies a referral by hand (audit-logged).</summary>
    /// <example><code>await clikgate.Referrals.DisqualifyAsync("rfl_01J…", "Same household");</code></example>
    public Task<Referral> DisqualifyAsync(string referralId, string reason, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        OverrideAsync(referralId, "disqualify", reason, requestOptions, cancellationToken);

    private Task<Referral> OverrideAsync(string referralId, string action, string reason, RequestOptions? requestOptions, CancellationToken ct)
    {
        var path = ReferralPath(referralId) + "/override";
        var body = new JsonObject { ["action"] = action, ["reason"] = Requester.RequireId(reason, "reason") };
        return ReferralAsync(new ApiRequest("POST", path).WithBody(body).With(requestOptions), ct);
    }

    /// <summary>Completes the referral's current goal step from your server.</summary>
    /// <example><code>await clikgate.Referrals.CompleteStepAsync("rfl_01J…", new CompleteStepParams { Goal = "first_deposit", OccurredAt = DateTimeOffset.UtcNow, Value = 15_000m, Currency = "NGN" });</code></example>
    public Task<Referral> CompleteStepAsync(string referralId, CompleteStepParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        var path = ReferralPath(referralId) + "/steps";
        var body = p.Wire();
        return ReferralAsync(new ApiRequest("POST", path).WithBody(body).With(requestOptions), cancellationToken);
    }

    /// <summary>
    /// Imports existing referrers (created or updated by background jobs). Lists longer than <see cref="ImportBatchSize"/>
    /// rows are sent in several requests, one job each. With an idempotency key <c>K</c>, the first request uses <c>K</c> and
    /// the next ones <c>K:1</c>, <c>K:2</c>, …, so the whole import can be resent safely.
    /// </summary>
    /// <example><code>var jobs = await clikgate.Referrals.ImportReferrersAsync("rpg_01J…", [new ReferrerImport { CustomerId = "user_1" }]);</code></example>
    public async Task<IReadOnlyList<Job>> ImportReferrersAsync(string programId, IReadOnlyList<ReferrerImport> rows, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        if (rows is null)
        {
            throw new ArgumentNullException(nameof(rows));
        }
        var path = ProgramPath(programId) + "/referrers/import";
        var jobs = new List<Job>();
        for (var from = 0; from < rows.Count; from += ImportBatchSize)
        {
            var batch = new JsonArray(rows.Skip(from).Take(ImportBatchSize).Select(r => (JsonNode)r.Wire()).ToArray());
            var options = requestOptions;
            if (from > 0 && requestOptions?.IdempotencyKey is string key)
            {
                options = new RequestOptions { IdempotencyKey = key + ":" + (from / ImportBatchSize).ToString(System.Globalization.CultureInfo.InvariantCulture), Timeout = requestOptions.Timeout, MaxRetries = requestOptions.MaxRetries };
            }
            var (_, data) = await CallAsync(new ApiRequest("POST", path).WithBody(new JsonObject { ["referrers"] = batch }).With(options), cancellationToken).ConfigureAwait(false);
            jobs.Add(new Job(data));
        }
        return jobs;
    }

    /// <summary>Blocks a referrer: their code and link stop creating referrals.</summary>
    /// <example><code>await clikgate.Referrals.BlockReferrerAsync("rfr_01J…", "Self-referrals");</code></example>
    public Task<Referrer> BlockReferrerAsync(string referrerId, string? reason = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var body = reason is null ? new JsonObject() : new JsonObject { ["reason"] = reason };
        return ReferrerAsync(new ApiRequest("POST", ReferrerPath(referrerId) + "/block").WithBody(body).With(requestOptions), cancellationToken);
    }

    /// <summary>Unblocks a referrer.</summary>
    /// <example><code>await clikgate.Referrals.UnblockReferrerAsync("rfr_01J…");</code></example>
    public Task<Referrer> UnblockReferrerAsync(string referrerId, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        ReferrerAsync(new ApiRequest("POST", ReferrerPath(referrerId) + "/unblock").With(requestOptions), cancellationToken);

    /// <summary>Changes a referrer's display name or attributes.</summary>
    /// <example><code>await clikgate.Referrals.UpdateReferrerAsync("rfr_01J…", new UpdateReferrerParams { DisplayName = "Ada L." });</code></example>
    public Task<Referrer> UpdateReferrerAsync(string referrerId, UpdateReferrerParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        return ReferrerAsync(new ApiRequest("PATCH", ReferrerPath(referrerId)).WithBody(p.Wire()).With(requestOptions), cancellationToken);
    }
}

/// <summary>Privacy requests: access, export, delete or erasure of one data subject's data.</summary>
public sealed class Privacy
{
    private readonly Core _core;

    internal Privacy(Core core) => _core = core;

    /// <summary>Starts a privacy request. It runs in the background: follow it with <see cref="GetRequestAsync"/> or the <c>privacy.request_completed</c> webhook.</summary>
    /// <example><code>var req = await clikgate.Privacy.CreateRequestAsync(new CreatePrivacyRequestParams { Type = "erasure", SubjectType = "customer_user", SubjectId = user.Id });</code></example>
    public async Task<PrivacyRequest> CreateRequestAsync(CreatePrivacyRequestParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/privacy/requests").WithBody(p.Wire()).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new PrivacyRequest(data as JsonObject);
    }

    /// <summary>A privacy request by ID.</summary>
    /// <example><code>var req = await clikgate.Privacy.GetRequestAsync("prq_01J…");</code></example>
    public async Task<PrivacyRequest> GetRequestAsync(string id, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var path = "/v1/privacy/requests/" + Requester.EncodePathSegment(Requester.RequireId(id, "id"));
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("GET", path).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new PrivacyRequest(data as JsonObject);
    }
}

/// <summary>People: read a person, search people and set the label your team sees.</summary>
public sealed class People
{
    private readonly Core _core;

    internal People(Core core) => _core = core;

    private static string PathOf(string personId) => "/v1/people/" + Requester.EncodePathSegment(Requester.RequireId(personId, "person_id"));

    /// <summary>A person by ID.</summary>
    /// <example><code>var person = await clikgate.People.GetAsync("per_01J…");</code></example>
    public async Task<Person> GetAsync(string personId, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("GET", PathOf(personId)).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Person(data as JsonObject);
    }

    /// <summary>One page of people matching a label, customer ID or click ID. <paramref name="cursor"/> is a page's <c>NextCursor</c>.</summary>
    /// <example><code>var page = await clikgate.People.SearchPageAsync("ada");</code></example>
    public async Task<Page<PersonSummary>> SearchPageAsync(string q, string? cursor = null, int? limit = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var body = new JsonObject { ["q"] = q ?? string.Empty };
        if (cursor is not null)
        {
            body["cursor"] = cursor;
        }
        if (limit is int l)
        {
            body["limit"] = l;
        }
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/people/search").WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Page<PersonSummary>(data as JsonObject, o => new PersonSummary(o));
    }

    /// <summary>Every person matching a label, customer ID or click ID, fetching pages lazily.</summary>
    /// <example><code>await foreach (var p in clikgate.People.SearchAsync("ada")) Console.WriteLine(p.Id);</code></example>
    public async IAsyncEnumerable<PersonSummary> SearchAsync(string q, RequestOptions? requestOptions = null, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        string? cursor = null;
        while (true)
        {
            var page = await SearchPageAsync(q, cursor, null, requestOptions, cancellationToken).ConfigureAwait(false);
            foreach (var p in page.Data)
            {
                yield return p;
            }
            if (!page.HasMore || string.IsNullOrEmpty(page.NextCursor))
            {
                yield break;
            }
            cursor = page.NextCursor;
        }
    }

    /// <summary>Sets the label your team sees instead of the click ID (<c>""</c> clears it).</summary>
    /// <example><code>await clikgate.People.SetLabelAsync("per_01J…", "Ada (VIP)");</code></example>
    public async Task<Person> SetLabelAsync(string personId, string label, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var body = new JsonObject { ["label"] = label };
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("PATCH", PathOf(personId)).WithBody(body).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new Person(data as JsonObject);
    }
}

/// <summary>App installs: find a customer's install, or an installation's.</summary>
public sealed class Installs
{
    private readonly Core _core;

    internal Installs(Core core) => _core = core;

    private async Task<Install> GetAsync(string path, string? appId, RequestOptions? requestOptions, CancellationToken ct)
    {
        var query = new Dictionary<string, object?>();
        if (appId is not null)
        {
            query["app_id"] = appId;
        }
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("GET", path, query).With(requestOptions), ct).ConfigureAwait(false);
        return new Install(data as JsonObject);
    }

    /// <summary>The latest install of your user with this ID (optionally in one app).</summary>
    /// <example><code>var install = await clikgate.Installs.GetByCustomerAsync(user.Id);</code></example>
    public Task<Install> GetByCustomerAsync(string customerId, string? appId = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        GetAsync("/v1/installs/by-customer-user/" + Requester.EncodePathSegment(Requester.RequireId(customerId, "customer_id")), appId, requestOptions, cancellationToken);

    /// <summary>The install of the mobile SDK's installation ID (from the <c>Clikgate-Installation</c> header). Send <paramref name="appId"/> when the ID is in several of your apps.</summary>
    /// <example><code>var install = await clikgate.Installs.GetByInstallationAsync(installation.InstallationId, installation.AppId);</code></example>
    public Task<Install> GetByInstallationAsync(string installationId, string? appId = null, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default) =>
        GetAsync("/v1/installs/by-installation/" + Requester.EncodePathSegment(Requester.RequireId(installationId, "installation_id")), appId, requestOptions, cancellationToken);
}

/// <summary>Codes: redeem a link, campaign or referral code someone gave offline.</summary>
public sealed class Codes
{
    private readonly Core _core;

    internal Codes(Core core) => _core = core;

    /// <summary>Redeems a code given offline (USSD, SMS, an agent, a till). A referral code can create a referral.</summary>
    /// <example><code>var r = await clikgate.Codes.RedeemAsync(new RedeemCodeParams { ExternalId = "ussd-881", Code = "ADA42", Channel = "ussd" });</code></example>
    public async Task<CodeRedemption> RedeemAsync(RedeemCodeParams parameters, RequestOptions? requestOptions = null, CancellationToken cancellationToken = default)
    {
        var p = parameters ?? throw new ArgumentNullException(nameof(parameters));
        var (_, data, _) = await _core.Requester.RequestAsync(new ApiRequest("POST", "/v1/codes/redeem").WithBody(p.Wire()).With(requestOptions), cancellationToken).ConfigureAwait(false);
        return new CodeRedemption(data as JsonObject);
    }
}
