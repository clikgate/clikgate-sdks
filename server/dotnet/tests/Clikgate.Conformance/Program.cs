// The .NET conformance runner (server/conformance/README.md, "Runner protocol"): starts the shared mock server, runs
// every case for language "dotnet" and lets the mock judge each one.
//   dotnet run --project tests/Clikgate.Conformance [-- --filter <substring>] [--verbose]
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Clikgate;
using Clikgate.Internal;

namespace Clikgate.Conformance;

internal static class Program
{
    private static readonly HttpClient Control = new(new SocketsHttpHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(60) };
    private static string _base = string.Empty;

    private static async Task<JsonNode?> ControlAsync(string path, JsonNode? body = null)
    {
        using var res = body is null
            ? await Control.GetAsync(new Uri(_base + "/__control" + path)).ConfigureAwait(false)
            : await Control.PostAsync(new Uri(_base + "/__control" + path), new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json")).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync().ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
        {
            throw new InvalidOperationException("control " + path + ": HTTP " + (int)res.StatusCode + " " + text);
        }
        return JsonNode.Parse(text);
    }

    private sealed class FakeClock(long now) : IClikgateClock
    {
        public long Now = now;
        public readonly List<long> Sleeps = [];

        public long NowMilliseconds() => Interlocked.Read(ref Now);

        public Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
        {
            lock (Sleeps)
            {
                Sleeps.Add((long)Math.Round(delay.TotalMilliseconds));
            }
            return Task.CompletedTask;
        }
    }

    private sealed class CaptureLogger : IClikgateLogger
    {
        public readonly List<string> Warnings = [];
        public readonly List<string> Logs = [];

        public void Log(ClikgateLogLevel level, string code, string message)
        {
            lock (Logs)
            {
                if (level == ClikgateLogLevel.Warning)
                {
                    Warnings.Add(code);
                }
                Logs.Add(message + " " + code);
            }
        }
    }

    private static object? Decode(JsonNode? v)
    {
        switch (v)
        {
            case null:
                return null;
            case JsonArray a:
                return a.Select(Decode).ToList();
            case JsonObject o when o.Count == 1:
                {
                    var (k, x) = o.First();
                    var s = x?.ToString() ?? string.Empty;
                    switch (k)
                    {
                        case "$decimal":
                            return decimal.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
                        case "$float":
                            return double.Parse(s, CultureInfo.InvariantCulture);
                        case "$bigint":
                            return long.Parse(s, CultureInfo.InvariantCulture);
                        case "$datetime":
                            return DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);
                        case "$bytes_base64":
                            return Convert.FromBase64String(s);
                        default:
                            return new Dictionary<string, object?> { [k] = Decode(x) };
                    }
                }
            case JsonObject o:
                return o.ToDictionary(kv => kv.Key, kv => Decode(kv.Value));
            case JsonValue jv when jv.TryGetValue(out string? str):
                return str;
            case JsonValue jv when jv.TryGetValue(out bool b):
                return b;
            case JsonValue jv:
                {
                    var raw = jv.ToJsonString();
                    if (long.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l))
                    {
                        return l; // not a ternary: it would widen the long to decimal
                    }
                    return decimal.Parse(raw, NumberStyles.Float, CultureInfo.InvariantCulture);
                }
            default:
                return null;
        }
    }

    private static JsonObject SerialiseError(Exception e)
    {
        if (e is ClikgateException c)
        {
            return new JsonObject
            {
                ["class"] = Errors.Canonical(c),
                ["code"] = c.Code,
                ["http_status"] = c.HttpStatus,
                ["param"] = c.Param,
                ["request_id"] = c.RequestId,
                ["type"] = c.Type,
                ["retry_after"] = c is RateLimitException r ? r.RetryAfter : c is ServerException s ? s.RetryAfter : null,
                ["field"] = c is PrivateModeFieldRejectedException p ? p.Field : null,
                ["index"] = c is InvalidRequestException ir ? ir.Index : null,
                ["allowed"] = c is InvalidRequestException ia && ia.Allowed is { } al ? new JsonArray(al.Select(x => (JsonNode?)x).ToArray()) : null,
                ["doc_url"] = c is InvalidRequestException id ? id.DocUrl : null,
                ["required_plan"] = c is PermissionException pe ? pe.RequiredPlan : null,
                ["limit"] = c is PermissionException pl ? pl.Limit : null,
                ["message"] = c.Message,
            };
        }
        return new JsonObject { ["class"] = e.GetType().Name, ["code"] = null, ["message"] = e.Message };
    }

    private static Dictionary<string, object?> Map(object? o) => o as Dictionary<string, object?> ?? [];

    private static Dictionary<string, object?>? InstallationWire(Installation? i) =>
        i is null ? null : new Dictionary<string, object?> { ["app_id"] = i.AppId, ["installation_id"] = i.InstallationId };

    private static string? Str(Dictionary<string, object?> a, string k) => a.TryGetValue(k, out var v) ? v as string : null;

    private static MoneyValue? Money(object? v) => v switch
    {
        null => null,
        decimal d => d,
        long l => l,
        string s => s,
        double dbl => throw new ArgumentException("value must be a decimal, long or decimal string, not Double"),
        _ => throw new ArgumentException("unsupported value " + v.GetType().Name),
    };

    private static T Fill<T>(T o, Dictionary<string, object?> a)
        where T : GoalOptions
    {
        o.Reference = Str(a, "reference");
        o.ClickId = Str(a, "click_id");
        o.Code = Str(a, "code");
        o.Value = Money(a.TryGetValue("value", out var v) ? v : null);
        o.Currency = Str(a, "currency");
        o.Provider = Str(a, "provider") is { } pv ? Provider.FromString(pv) : (Provider?)null;
        o.IsFirst = a.TryGetValue("is_first", out var f) ? f as bool? : null;
        o.Label = Str(a, "label");
        o.KeptBy = Str(a, "kept_by");
        o.BrowserEngine = Str(a, "browser_engine");
        o.Platform = Str(a, "platform");
        o.HashedEmail = Str(a, "hashed_email");
        o.HashedPhoneE164 = Str(a, "hashed_phone_e164");
        o.HashedPhoneDigits = Str(a, "hashed_phone_digits");
        if (a.TryGetValue("occurred_at", out var at))
        {
            if (at is DateTimeOffset dto)
            {
                o.OccurredAt = dto;
            }
            else
            {
                o.OccurredAtString = at as string;
            }
        }
        o.Metadata = a.TryGetValue("metadata", out var m) ? m as Dictionary<string, object?> : null;
        o.Consent = a.TryGetValue("consent", out var cn) ? cn as Dictionary<string, object?> : null;
        o.Extra = a.TryGetValue("extra", out var ex) ? ex as Dictionary<string, object?> : null;
        return o;
    }

    private static PaymentConfirmParams ConfirmParams(Dictionary<string, object?> a)
    {
        var p = new PaymentConfirmParams
        {
            Provider = Str(a, "provider") is { } pv ? Provider.FromString(pv) : (Provider?)null,
            Reference = Str(a, "reference"),
            Status = Str(a, "status"),
            Amount = Money(a.TryGetValue("amount", out var v) ? v : null),
            AmountMinor = a.TryGetValue("amount_minor", out var am) ? am as long? : null,
            Currency = Str(a, "currency"),
            Aliases = (a.TryGetValue("aliases", out var al) ? al as List<object?> : null)?.Cast<string>().ToList(),
            ClickId = Str(a, "click_id"),
            Goal = Str(a, "goal"),
            Test = a.TryGetValue("test", out var t) ? t as bool? : null,
            Extra = a.TryGetValue("extra", out var ex) ? ex as Dictionary<string, object?> : null,
        };
        if (a.TryGetValue("occurred_at", out var at))
        {
            if (at is DateTimeOffset dto)
            {
                p.OccurredAt = dto;
            }
            else
            {
                p.OccurredAtString = at as string;
            }
        }
        return p;
    }

    private static CookieOptions Cookie(Dictionary<string, object?> a)
    {
        var o = new CookieOptions();
        if (a.TryGetValue("days", out var d) && d is not null)
        {
            o.Days = Convert.ToDouble(d, CultureInfo.InvariantCulture);
        }
        if (a.TryGetValue("secure", out var s) && s is bool b)
        {
            o.Secure = b;
        }
        o.Domain = Str(a, "domain");
        return o;
    }

    private static byte[] Bytes(object? raw) => raw as byte[] ?? Encoding.UTF8.GetBytes(raw as string ?? string.Empty);

    private static JsonNode? Canonical(object? r) => r switch
    {
        null => null,
        Referrer rc => WithCreated(rc),
        Referral rl => ReferralWire(rl),
        Page<Referral> pr => PageWire(pr.Raw, pr.Data),
        WireObject w => w.Raw.DeepClone(),
        WireRecord w => w.Raw.DeepClone(),
        IEnumerable<WireRecord> list => new JsonArray(list.Select(Canonical).ToArray()),
        LinkUpdateResult u => u.ToJson(),
        JsonNode n => n,
        _ => Json.ToNode(r),
    };

    private static JsonObject WithCreated(Referrer r)
    {
        var o = (JsonObject)r.Raw.DeepClone();
        o["created"] = r.Created;
        return o;
    }

    /// <summary>The referral as wire JSON, each reward side with its typed <c>amount</c> (normal units) added.</summary>
    private static JsonObject ReferralWire(Referral r)
    {
        var o = (JsonObject)r.Raw.DeepClone();
        if (r.Reward is { } reward && o["reward_snapshot"] is JsonObject rw)
        {
            if (reward.Referrer?.Amount is decimal a && rw["referrer"] is JsonObject ro)
            {
                ro["amount"] = a.ToString(CultureInfo.InvariantCulture);
            }
            if (reward.Referee?.Amount is decimal b && rw["referee"] is JsonObject re)
            {
                re["amount"] = b.ToString(CultureInfo.InvariantCulture);
            }
        }
        return o;
    }

    private static JsonObject PageWire(JsonObject raw, IEnumerable<object> data)
    {
        var o = (JsonObject)raw.DeepClone();
        o["data"] = new JsonArray(data.Select(Canonical).ToArray());
        return o;
    }

    private static string? Arg(Dictionary<string, object?> a, Dictionary<string, object?> p, params string[] keys)
    {
        foreach (var k in keys)
        {
            var v = a.TryGetValue(k, out var x) ? x : p.TryGetValue(k, out var y) ? y : null;
            if (v is not null)
            {
                return Convert.ToString(v, CultureInfo.InvariantCulture);
            }
        }
        return null;
    }

    private static object? Raw(Dictionary<string, object?> a, Dictionary<string, object?> p, string key) => a.TryGetValue(key, out var x) ? x : p.TryGetValue(key, out var y) ? y : null;

    private static bool Has(Dictionary<string, object?> a, Dictionary<string, object?> p, string key) => a.ContainsKey(key) || p.ContainsKey(key);

    private static DateTimeOffset? Time(object? v) => v switch
    {
        DateTimeOffset d => d,
        string s => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal),
        _ => null,
    };

    private static async Task<Dictionary<string, object?>> ItemsAsync<T>(IAsyncEnumerable<T> items, object? max)
        where T : WireRecord
    {
        var list = new List<JsonNode?>();
        await foreach (var x in items.ConfigureAwait(false))
        {
            list.Add(Canonical(x));
            if (max is long m && list.Count >= m)
            {
                break;
            }
        }
        return new Dictionary<string, object?> { ["items"] = new JsonArray(list.ToArray()) };
    }

    private static ListReferralsParams ReferralQuery(Dictionary<string, object?> a, Dictionary<string, object?> p) => new()
    {
        ProgramId = Arg(a, p, "program_id"),
        ReferrerId = Arg(a, p, "referrer_id"),
        RefereeCustomerId = Arg(a, p, "referee_customer_id", "referee_customer_user_id"),
        Status = Arg(a, p, "status"),
        From = Time(Raw(a, p, "from")),
        To = Time(Raw(a, p, "to")),
        Limit = Raw(a, p, "limit") is long l ? (int)l : null,
        StartingAfter = Arg(a, p, "starting_after"),
        EndingBefore = Arg(a, p, "ending_before"),
    };

    private static object? As(WebhookEvent ev, string? accessor) => accessor switch
    {
        null => ev,
        "referral" => ev.AsReferral(),
        "referrer" => ev.AsReferrer(),
        "goal_event" => ev.AsGoalEvent(),
        "install" => ev.AsInstall(),
        "payment" => ev.AsPayment(),
        "conversion" => ev.AsConversion(),
        _ => throw new InvalidOperationException("runner: unknown accessor " + accessor),
    };

    private static async Task<object?> TypedStepAsync(ClikgateClient client, string call, Dictionary<string, object?> a, Dictionary<string, object?> p, RequestOptions? ro)
    {
        switch (call)
        {
            case "referrals.get_or_create_referrer":
                return await client.Referrals.GetOrCreateReferrerAsync(Arg(a, p, "program_id")!, new GetOrCreateReferrerParams
                {
                    CustomerId = Arg(a, p, "customer_id", "customer_user_id") ?? string.Empty,
                    DisplayName = Arg(a, p, "display_name"),
                    ExternalCode = Arg(a, p, "external_code"),
                }, ro).ConfigureAwait(false);
            case "referrals.get_referrer":
                return await client.Referrals.GetReferrerAsync(Arg(a, p, "referrer_id", "id")!).ConfigureAwait(false);
            case "referrals.find_referrer":
                return await client.Referrals.FindReferrerAsync(Arg(a, p, "program_id")!, new FindReferrerParams { Code = Arg(a, p, "code"), CustomerId = Arg(a, p, "customer_id", "customer_user_id") }).ConfigureAwait(false);
            case "referrals.get":
                return await client.Referrals.GetAsync(Arg(a, p, "referral_id", "id")!).ConfigureAwait(false);
            case "referrals.list":
                return await ItemsAsync(client.Referrals.ListAsync(ReferralQuery(a, p)), a.TryGetValue("max_items", out var mx) ? mx : null).ConfigureAwait(false);
            case "referrals.list_page":
                return await client.Referrals.ListPageAsync(ReferralQuery(a, p)).ConfigureAwait(false);
            case "referrals.qualify":
                return await client.Referrals.QualifyAsync(Arg(a, p, "referral_id", "id")!, Arg(a, p, "reason") ?? string.Empty, ro).ConfigureAwait(false);
            case "referrals.disqualify":
                return await client.Referrals.DisqualifyAsync(Arg(a, p, "referral_id", "id")!, Arg(a, p, "reason") ?? string.Empty, ro).ConfigureAwait(false);
            case "referrals.complete_step":
                return await client.Referrals.CompleteStepAsync(Arg(a, p, "referral_id", "id")!, new CompleteStepParams
                {
                    Goal = Arg(a, p, "goal") ?? string.Empty,
                    OccurredAt = Time(Raw(a, p, "occurred_at")),
                    Value = Money(Raw(a, p, "value")),
                    Currency = Arg(a, p, "currency"),
                }, ro).ConfigureAwait(false);
            case "referrals.import_referrers":
                {
                    var rows = ((Raw(a, p, "rows") as List<object?>) ?? []).Select(Map).Select(r => new ReferrerImport
                    {
                        CustomerId = Arg(r, r, "customer_id", "customer_user_id") ?? string.Empty,
                        ExternalCode = Arg(r, r, "external_code"),
                        DisplayName = Arg(r, r, "display_name"),
                    }).ToList();
                    return await client.Referrals.ImportReferrersAsync(Arg(a, p, "program_id")!, rows, ro).ConfigureAwait(false);
                }
            case "referrals.block_referrer":
                return await client.Referrals.BlockReferrerAsync(Arg(a, p, "referrer_id", "id")!, Arg(a, p, "reason"), ro).ConfigureAwait(false);
            case "referrals.unblock_referrer":
                return await client.Referrals.UnblockReferrerAsync(Arg(a, p, "referrer_id", "id")!, ro).ConfigureAwait(false);
            case "referrals.update_referrer":
                return await client.Referrals.UpdateReferrerAsync(Arg(a, p, "referrer_id", "id")!, new UpdateReferrerParams
                {
                    DisplayName = Arg(a, p, "display_name"),
                    ClearDisplayName = Has(a, p, "display_name") && Raw(a, p, "display_name") is null,
                    Attributes = Raw(a, p, "attributes") as Dictionary<string, object?>,
                    ClearAttributes = Has(a, p, "attributes") && Raw(a, p, "attributes") is null,
                }, ro).ConfigureAwait(false);
            case "privacy.create_request":
                return await client.Privacy.CreateRequestAsync(new CreatePrivacyRequestParams
                {
                    Type = Arg(a, p, "type") ?? string.Empty,
                    SubjectType = Arg(a, p, "subject_type") ?? string.Empty,
                    SubjectId = Arg(a, p, "subject_id") ?? string.Empty,
                    AppId = Arg(a, p, "app_id"),
                }, ro).ConfigureAwait(false);
            case "privacy.get_request":
                return await client.Privacy.GetRequestAsync(Arg(a, p, "id", "request_id")!).ConfigureAwait(false);
            case "links.archive":
                return await client.Links.ArchiveAsync(Arg(a, p, "id")!).ConfigureAwait(false);
            case "links.get_by_reference":
                return await client.Links.GetByReferenceAsync(Arg(a, p, "reference", "external_reference")!).ConfigureAwait(false);
            case "links.pause":
                return await client.Links.PauseAsync(Arg(a, p, "id")!, ro).ConfigureAwait(false);
            case "links.resume":
                return await client.Links.ResumeAsync(Arg(a, p, "id")!, ro).ConfigureAwait(false);
            case "people.get":
                return await client.People.GetAsync(Arg(a, p, "person_id", "id")!).ConfigureAwait(false);
            case "people.search":
                return await ItemsAsync(client.People.SearchAsync(Arg(a, p, "q") ?? string.Empty), a.TryGetValue("max_items", out var pm) ? pm : null).ConfigureAwait(false);
            case "people.search_page":
                return await client.People.SearchPageAsync(Arg(a, p, "q") ?? string.Empty, Arg(a, p, "cursor"), Raw(a, p, "limit") is long sl ? (int)sl : null).ConfigureAwait(false);
            case "people.set_label":
                return await client.People.SetLabelAsync(Arg(a, p, "person_id", "id")!, Arg(a, p, "label") ?? string.Empty, ro).ConfigureAwait(false);
            case "installs.get_by_customer":
                return await client.Installs.GetByCustomerAsync(Arg(a, p, "customer_id", "customer_user_id")!, Arg(a, p, "app_id")).ConfigureAwait(false);
            case "installs.get_by_installation":
                return await client.Installs.GetByInstallationAsync(Arg(a, p, "installation_id")!, Arg(a, p, "app_id")).ConfigureAwait(false);
            case "codes.redeem":
                return await client.Codes.RedeemAsync(new RedeemCodeParams
                {
                    ExternalId = Arg(a, p, "external_id") ?? string.Empty,
                    Code = Arg(a, p, "code") ?? string.Empty,
                    Channel = Arg(a, p, "channel") ?? string.Empty,
                    AppId = Arg(a, p, "app_id"),
                    OccurredAt = Time(Raw(a, p, "occurred_at")),
                    Metadata = Raw(a, p, "metadata") as Dictionary<string, object?>,
                    AgentId = Arg(a, p, "agent_id"),
                    Subject = Raw(a, p, "subject") is Dictionary<string, object?> sj ? new OfflineSubject { Type = Arg(sj, sj, "type") ?? string.Empty, Id = Arg(sj, sj, "id") } : null,
                    Location = Raw(a, p, "location") is Dictionary<string, object?> lc ? new OfflineLocation { Country = Arg(lc, lc, "country"), Region = Arg(lc, lc, "region"), City = Arg(lc, lc, "city"), StoreId = Arg(lc, lc, "store_id") } : null,
                }, ro).ConfigureAwait(false);
            case "webhooks.typed":
                return As(Webhooks.Verify(Bytes(a["raw_body"]), Str(a, "header"), Str(a, "secret")!, (long)a["tolerance"]!, (long)a["now"]!), Str(a, "as"));
            case "webhooks.event_types":
                return new Dictionary<string, object?> { ["value"] = EventType.All.OrderBy(x => x, StringComparer.Ordinal).ToList() };
            default:
                throw new InvalidOperationException("runner: unknown call " + call);
        }
    }

    private static async Task<object?> StepAsync(ClikgateClient client, string call, Dictionary<string, object?> a, FakeClock clock, JsonObject? rawArgs)
    {
        var ro = Str(a, "idempotency_key") is { } key ? new RequestOptions { IdempotencyKey = key } : null;
        var p = a.TryGetValue("params", out var pp) ? pp as Dictionary<string, object?> ?? [] : [];
        TimeSpan T() => TimeSpan.FromMilliseconds(a.TryGetValue("timeout_ms", out var t) && t is long l ? l : 10_000);
        switch (call)
        {
            case "client.mode":
                return new Dictionary<string, object?> { ["value"] = client.Mode };
            case "goal":
                client.Goal(Str(a, "key")!, Fill(new GoalOptions(), a));
                return null;
            case "goals.send":
                return await client.Goals.SendAsync(Str(a, "key")!, Fill(new GoalOptions(), a), ro).ConfigureAwait(false);
            case "goals.send_batch":
                return await client.Goals.SendBatchAsync(((List<object?>)a["events"]!).Select(e => Fill(new GoalBatchEvent { Goal = Str(Map(e), "goal") }, Map(e))).ToList()).ConfigureAwait(false);
            case "goals.reverse":
                return await client.Goals.ReverseAsync(Str(a, "key")!, Str(a, "reference") ?? string.Empty, Money(a.TryGetValue("value", out var rv) ? rv : null), Str(a, "reason")).ConfigureAwait(false);
            case "flush":
                return new Dictionary<string, object?> { ["value"] = await client.FlushAsync(T()).ConfigureAwait(false) };
            case "close":
                return new Dictionary<string, object?> { ["value"] = await client.CloseAsync(T()).ConfigureAwait(false) };
            case "advance_clock":
                Interlocked.Add(ref clock.Now, (long)a["ms"]!);
                return null;
            case "config.get":
                return await client.ConfigAsync().ConfigureAwait(false);
            case "conversions.create":
                return await client.Conversions.CreateAsync(p, ro).ConfigureAwait(false);
            case "conversions.reverse":
                return await client.Conversions.ReverseAsync(Str(a, "id")!, p).ConfigureAwait(false);
            case "links.create":
                return a.ContainsKey("typed") ? await client.Links.CreateAsync(new LinkCreateParams { Extra = p }, ro).ConfigureAwait(false) : await client.Links.CreateAsync(p, ro).ConfigureAwait(false);
            case "links.get":
                return await client.Links.GetAsync(Str(a, "id")!).ConfigureAwait(false);
            case "links.update":
                return a.ContainsKey("typed") ? await client.Links.UpdateAsync(Str(a, "id")!, new LinkUpdateParams { Extra = p }, ro).ConfigureAwait(false) : await client.Links.UpdateAsync(Str(a, "id")!, p, ro).ConfigureAwait(false);
            case "links.list":
                {
                    var items = new JsonArray();
                    var max = a.TryGetValue("max_items", out var mi) && mi is long ml ? ml : long.MaxValue;
                    await foreach (var link in client.Links.ListAsync(p).ConfigureAwait(false))
                    {
                        items.Add(link.Raw.DeepClone());
                        if (items.Count >= max)
                        {
                            break;
                        }
                    }
                    return new JsonObject { ["items"] = items };
                }
            case "links.list_page":
                return await client.Links.ListPageAsync(p).ConfigureAwait(false);
            case "links.qr":
                {
                    var q = a.Where(kv => kv.Key != "id").ToDictionary(kv => kv.Key, kv => kv.Value);
                    var qr = await client.Links.QrAsync(Str(a, "id")!, q).ConfigureAwait(false);
                    return new JsonObject { ["content_type"] = qr.ContentType, ["bytes_length"] = qr.Data.Length };
                }
            case "clicks.get":
                return await client.Clicks.GetAsync(Str(a, "id")!).ConfigureAwait(false);
            case "webhooks.verify":
                return As(Webhooks.Verify(Bytes(a["raw_body"]), Str(a, "header"), Str(a, "secret")!, (long)a["tolerance"]!, (long)a["now"]!), Str(a, "as"));
            case "webhooks.verify_any":
                return Webhooks.VerifyAny(Bytes(a["raw_body"]), Str(a, "header"), ((List<object?>)a["secrets"]!).Cast<string>().ToList(), (long)a["tolerance"]!, (long)a["now"]!);
            case "installations.parse_header":
                return new Dictionary<string, object?> { ["value"] = InstallationWire(Installation.ParseHeader(Str(a, "value"))) };
            case "installations.from_request":
                {
                    var r = Map(a["request"]);
                    var values = Map(r.TryGetValue("headers", out var ih) ? ih : null)
                        .Where(kv => string.Equals(kv.Key, Installation.Header, StringComparison.OrdinalIgnoreCase))
                        .Select(kv => kv.Value as string)
                        .ToList();
                    return new Dictionary<string, object?> { ["value"] = InstallationWire(values.Count == 1 ? Installation.ParseHeader(values[0]) : null) };
                }
            case "click_ids.is_valid":
                return new Dictionary<string, object?> { ["value"] = ClickIds.IsValid(a.TryGetValue("id", out var iv) ? iv : null) };
            case "click_ids.from_request":
                {
                    var r = Map(a["request"]);
                    var headers = Map(r.TryGetValue("headers", out var h) ? h : null).Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value as string ?? string.Empty));
                    return new Dictionary<string, object?> { ["value"] = client.ClickIds.FromRequest(Str(r, "url"), headers) };
                }
            case "click_ids.cookie_header":
                return new Dictionary<string, object?> { ["value"] = client.ClickIds.CookieHeader(Str(a, "id")!, Cookie(a)) };
            case "click_ids.persist":
                {
                    var list = (a.TryGetValue("existing_set_cookie", out var ex) ? ex as List<object?> : null)?.Cast<string>().ToList() ?? [];
                    client.ClickIds.Persist((_, value) => list.Add(value), Str(a, "id")!, Cookie(a));
                    return new JsonObject { ["set_cookie"] = new JsonArray(list.Select(x => (JsonNode?)x).ToArray()) };
                }
            case "click_ids.context":
                {
                    var r = Map(a["request"]);
                    var headers = Map(r.TryGetValue("headers", out var h) ? h : null).Select(kv => new KeyValuePair<string, string>(kv.Key, kv.Value as string ?? string.Empty));
                    var c = client.ClickIds.Context(Str(r, "url"), headers);
                    return new JsonObject { ["click_id"] = c.ClickId, ["kept_by"] = c.KeptBy, ["browser_engine"] = c.BrowserEngine, ["platform"] = c.Platform };
                }
            case "click_ids.keep":
                {
                    var r = Map(a["request"]);
                    var http = new Microsoft.AspNetCore.Http.DefaultHttpContext();
                    var uri = new Uri(Str(r, "url")!, UriKind.RelativeOrAbsolute);
                    http.Request.Method = Str(r, "method")!;
                    if (uri.IsAbsoluteUri)
                    {
                        http.Request.Scheme = uri.Scheme;
                        http.Request.Path = uri.AbsolutePath;
                        http.Request.QueryString = new Microsoft.AspNetCore.Http.QueryString(uri.Query);
                    }
                    foreach (var kv in Map(r.TryGetValue("headers", out var h) ? h : null))
                    {
                        http.Request.Headers[kv.Key] = kv.Value as string ?? string.Empty;
                    }
                    http.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(Str(r, "body") ?? string.Empty));
                    var bodyOut = new MemoryStream();
                    http.Response.Body = bodyOut;
                    var handler = Microsoft.AspNetCore.Builder.ClikgateEndpointRouteBuilderExtensions.CreateClikgateKeepHandler(client.ClickIds.KeepRoute(Cookie(a)));
                    await handler(http).ConfigureAwait(false);
                    var res = http.Response;
                    var outcome = new JsonObject
                    {
                        ["status"] = res.StatusCode,
                        ["cache_control"] = res.Headers.CacheControl.ToString(),
                        ["set_cookie"] = new JsonArray(res.Headers.SetCookie.Select(x => (JsonNode?)x).ToArray()),
                        ["body"] = Encoding.UTF8.GetString(bodyOut.ToArray()),
                        ["location"] = res.Headers.Location.Count == 0 ? null : res.Headers.Location.ToString(),
                    };
                    if (res.Headers.Allow.Count > 0)
                    {
                        outcome["allow"] = res.Headers.Allow.ToString();
                    }
                    return outcome;
                }
            case "click_ids.from_payment_metadata":
                return new Dictionary<string, object?> { ["value"] = client.ClickIds.FromPaymentMetadata(Json.ToNode(a.TryGetValue("payload", out var pl) ? pl : null)) };
            case "hash_for_ads":
                {
                    var h = HashForAds.Hash(Str(a, "email"), Str(a, "phone"));
                    var hashed = new Dictionary<string, object?>();
                    if (h.HashedEmail is not null)
                    {
                        hashed["hashed_email"] = h.HashedEmail;
                    }
                    if (h.HashedPhoneE164 is not null)
                    {
                        hashed["hashed_phone_e164"] = h.HashedPhoneE164;
                    }
                    if (h.HashedPhoneDigits is not null)
                    {
                        hashed["hashed_phone_digits"] = h.HashedPhoneDigits;
                    }
                    return hashed;
                }
            case "money.format":
                return new Dictionary<string, object?>
                {
                    ["value"] = a["value"] switch
                    {
                        decimal d => Clikgate.Money.FormatValue(d),
                        long l => Clikgate.Money.FormatValue(l),
                        string s => Clikgate.Money.FormatValue(s),
                        _ => throw new ArgumentException("unsupported value"),
                    },
                };
            case "identify_user":
                return await client.IdentifyUserAsync(new IdentifyUserParams
                {
                    ClickId = Str(a, "click_id"),
                    Installation = Str(a, "installation"),
                    AppId = Str(a, "app_id"),
                    InstallationId = Str(a, "installation_id"),
                    CustomerId = Str(a, "customer_id"),
                    Label = Str(a, "label"),
                }, ro).ConfigureAwait(false);
            case "payments.confirm":
                return await client.Payments.ConfirmAsync(ConfirmParams(a), ro).ConfigureAwait(false);
            case "payments.from":
            case "payments.build":
                {
                    var gateway = Str(a, "gateway");
                    var options = new PaymentHelperOptions { Goal = Str(a, "goal"), ClickId = Str(a, "click_id") };
                    var response = rawArgs?["response"];
                    // numbers reach the helper as their raw JSON text (JsonElement), never through a double
                    var text = response is JsonValue sv && sv.TryGetValue(out string? st) ? st : null;
                    var element = text is null ? JsonDocument.Parse(response?.ToJsonString() ?? "null").RootElement.Clone() : default;
                    if (call == "payments.build")
                    {
                        JsonObject? body = (gateway, text) switch
                        {
                            ("paystack", null) => client.Payments.BuildFromPaystack(element, options),
                            ("paystack", _) => client.Payments.BuildFromPaystack(text, options),
                            ("flutterwave", null) => client.Payments.BuildFromFlutterwave(element, options),
                            ("flutterwave", _) => client.Payments.BuildFromFlutterwave(text, options),
                            ("monnify", null) => client.Payments.BuildFromMonnify(element, options),
                            ("monnify", _) => client.Payments.BuildFromMonnify(text, options),
                            ("stripe", null) => client.Payments.BuildFromStripe(element, options),
                            ("stripe", _) => client.Payments.BuildFromStripe(text, options),
                            _ => throw new InvalidOperationException("runner: unknown gateway " + gateway),
                        };
                        return new JsonObject { ["value"] = body };
                    }
                    return (gateway, text) switch
                    {
                        ("paystack", null) => await client.Payments.FromPaystackAsync(element, options).ConfigureAwait(false),
                        ("paystack", _) => await client.Payments.FromPaystackAsync(text, options).ConfigureAwait(false),
                        ("flutterwave", null) => await client.Payments.FromFlutterwaveAsync(element, options).ConfigureAwait(false),
                        ("flutterwave", _) => await client.Payments.FromFlutterwaveAsync(text, options).ConfigureAwait(false),
                        ("monnify", null) => await client.Payments.FromMonnifyAsync(element, options).ConfigureAwait(false),
                        ("monnify", _) => await client.Payments.FromMonnifyAsync(text, options).ConfigureAwait(false),
                        ("stripe", null) => await client.Payments.FromStripeAsync(element, options).ConfigureAwait(false),
                        ("stripe", _) => await client.Payments.FromStripeAsync(text, options).ConfigureAwait(false),
                        _ => throw new InvalidOperationException("runner: unknown gateway " + gateway),
                    };
                }
            default:
                return await TypedStepAsync(client, call, a, p, ro).ConfigureAwait(false);
        }
    }

    private static async Task<JsonNode?> RunCaseAsync(JsonObject c)
    {
        var cl = (JsonObject)c["client"]!;
        var clock = new FakeClock((long)c["now_ms"]!);
        var logger = new CaptureLogger();
        var onError = new JsonArray();
        var rand = (c["random"] as JsonArray ?? []).Select(x => (double)x!).ToList();
        var draw = 0;
        var pm = cl["private_mode"];
        var options = new ClikgateOptions
        {
            ApiKey = Json.Str(cl["api_key"]),
            BaseUrl = Json.Str(cl["base_url"]),
            Timeout = TimeSpan.FromMilliseconds((long)cl["timeout_ms"]!),
            MaxRetries = (int)cl["max_retries"]!,
            SendMode = Json.Str(cl["send_mode"]) == "sync" ? SendMode.Sync : SendMode.Background,
            PrivateMode = Json.Bool(pm) == true ? PrivateMode.On : Json.Bool(pm) == false ? PrivateMode.Off : PrivateMode.Auto,
            ClickIdParam = Json.Str(cl["click_id_param"]),
            BatchSize = (int)cl["batch_size"]!,
            FlushInterval = TimeSpan.FromMilliseconds((long)cl["flush_interval_ms"]!),
            MaxQueueSize = (int)cl["max_queue_size"]!,
            ShutdownHooks = false,
            NoProxy = true,
            Logger = logger,
            Clock = clock,
            Random = () => rand.Count == 0 ? 0.5 : rand[draw++ % rand.Count],
            OnError = (e, ctx) =>
            {
                var o = SerialiseError(e);
                o["events"] = new JsonArray(ctx.Events.Select(x => (JsonNode)new JsonObject { ["goal"] = x.Goal, ["reference"] = x.Reference }).ToArray());
                o["dropped"] = ctx.Dropped;
                o["operation"] = ctx.Operation;
                lock (onError)
                {
                    onError.Add(o);
                }
            },
        };
        JsonObject Outcome(JsonArray steps, JsonNode? constructError)
        {
            lock (logger.Logs)
            {
                lock (onError)
                {
                    return new JsonObject
                    {
                        ["case_id"] = c["id"]!.DeepClone(),
                        ["language"] = "dotnet",
                        ["construct_error"] = constructError,
                        ["steps"] = steps,
                        ["sleeps_ms"] = new JsonArray(clock.Sleeps.Select(s => (JsonNode)s).ToArray()),
                        ["warnings"] = new JsonArray(logger.Warnings.Select(s => (JsonNode)s).ToArray()),
                        ["logs"] = new JsonArray(logger.Logs.Select(s => (JsonNode)s).ToArray()),
                        ["on_error"] = onError.DeepClone(),
                    };
                }
            }
        }
        ClikgateClient client;
        try
        {
            client = new ClikgateClient(options);
        }
        catch (Exception e)
        {
            return await ControlAsync("/finish", Outcome([], SerialiseError(e))).ConfigureAwait(false);
        }
        var steps = new JsonArray();
        foreach (var s in (JsonArray)c["steps"]!)
        {
            var step = (JsonObject)s!;
            var a = Map(Decode(step["args"] ?? new JsonObject()));
            try
            {
                var result = await StepAsync(client, Json.Str(step["call"])!, a, clock, step["args"] as JsonObject).ConfigureAwait(false);
                steps.Add(new JsonObject { ["result"] = Canonical(result) });
            }
            catch (Exception e)
            {
                steps.Add(new JsonObject { ["error"] = SerialiseError(e) });
            }
        }
        var verdict = await ControlAsync("/finish", Outcome(steps, null)).ConfigureAwait(false);
        await client.CloseAsync(TimeSpan.FromSeconds(1)).ConfigureAwait(false);
        return verdict;
    }

    public static async Task<int> Main(string[] args)
    {
        var filter = Array.IndexOf(args, "--filter") is var fi and >= 0 && fi + 1 < args.Length ? args[fi + 1] : null;
        var verbose = args.Contains("--verbose");
        foreach (var k in new[] { "CLIKGATE_API_KEY", "CLIKGATE_BASE_URL", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy" })
        {
            Environment.SetEnvironmentVariable(k, null);
        }
        var dir = AppContext.BaseDirectory;
        string? mock = null;
        for (var d = new DirectoryInfo(dir); d is not null; d = d.Parent)
        {
            var candidate = Path.Combine(d.FullName, "conformance", "mock-server", "server.mjs");
            if (File.Exists(candidate))
            {
                mock = candidate;
                break;
            }
        }
        if (mock is null)
        {
            Console.Error.WriteLine("conformance: server/conformance/mock-server/server.mjs not found");
            return 1;
        }
        using var child = Process.Start(new ProcessStartInfo("node") { ArgumentList = { mock, "--port", "0" }, RedirectStandardOutput = true, UseShellExecute = false })!;
        var passed = 0;
        var failed = 0;
        try
        {
            string? line;
            while ((line = await child.StandardOutput.ReadLineAsync().ConfigureAwait(false)) is not null)
            {
                var m = Regex.Match(line.Trim(), "^CLIKGATE_MOCK_READY (.*)$");
                if (m.Success)
                {
                    _base = "http://127.0.0.1:" + JsonNode.Parse(m.Groups[1].Value)!["port"];
                    break;
                }
            }
            var cases = (JsonArray)(await ControlAsync("/cases?language=dotnet").ConfigureAwait(false))!["cases"]!;
            foreach (var cn in cases)
            {
                var c = (JsonObject)cn!;
                var id = Json.Str(c["id"])!;
                if (filter is not null && !id.Contains(filter, StringComparison.Ordinal))
                {
                    continue;
                }
                var started = (JsonObject)(await ControlAsync("/start", new JsonObject { ["case_id"] = id }).ConfigureAwait(false))!;
                var verdict = await RunCaseAsync(started).ConfigureAwait(false);
                if (Json.Bool(verdict?["ok"]) == true)
                {
                    passed++;
                    if (verbose)
                    {
                        Console.WriteLine("ok   " + id);
                    }
                }
                else
                {
                    failed++;
                    Console.WriteLine("FAIL " + id + ": " + Json.Str(c["description"]) + "\n  - " + string.Join("\n  - ", (verdict?["failures"] as JsonArray ?? []).Select(x => x?.ToString())));
                }
            }
        }
        finally
        {
            child.Kill();
        }
        Console.WriteLine("\nconformance (dotnet): " + passed + " passed, " + failed + " failed, " + (passed + failed) + " total");
        return failed > 0 || passed == 0 ? 1 : 0;
    }
}
