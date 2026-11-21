using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>The parameters of <see cref="Referrals.GetOrCreateReferrerAsync(string, GetOrCreateReferrerParams, RequestOptions?, System.Threading.CancellationToken)"/>.</summary>
/// <example><code>new GetOrCreateReferrerParams { CustomerId = user.Id, DisplayName = "Ada" }</code></example>
public sealed record GetOrCreateReferrerParams
{
    /// <summary>Required: your signed-in user's ID (never a value read from the request).</summary>
    public string CustomerId { get; init; } = string.Empty;

    /// <summary>The name shown to the people they refer.</summary>
    public string? DisplayName { get; init; }

    /// <summary>Your own code for this referrer.</summary>
    public string? ExternalCode { get; init; }

    /// <summary>The referral code to give a new referrer (default: one Clikgate makes up). An existing referrer keeps theirs.</summary>
    public string? Code { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject { ["customer_user_id"] = Requester.RequireId(CustomerId, "customer_id") };
        if (Code is not null)
        {
            o["code"] = Code;
        }
        if (DisplayName is not null)
        {
            o["display_name"] = DisplayName;
        }
        if (ExternalCode is not null)
        {
            o["external_code"] = ExternalCode;
        }
        return o;
    }
}

/// <summary>Who <see cref="Referrals.FindReferrerAsync"/> looks for: set <see cref="CustomerId"/> or <see cref="Code"/>.</summary>
/// <example><code>new FindReferrerParams { Code = "ADA42" }</code></example>
public sealed record FindReferrerParams
{
    /// <summary>The referrer of your user with this ID.</summary>
    public string? CustomerId { get; init; }

    /// <summary>The referrer with this referral code. Set exactly one of the two (<c>invalid_argument</c> otherwise).</summary>
    public string? Code { get; init; }
}

/// <summary>Filters for <see cref="Referrals.ListAsync"/> and <see cref="Referrals.ListPageAsync"/>.</summary>
/// <example><code>new ListReferralsParams { ProgramId = programId, Status = "qualified", Limit = 100 }</code></example>
public sealed record ListReferralsParams
{
    /// <summary>The program.</summary>
    public string? ProgramId { get; init; }

    /// <summary>The referrer.</summary>
    public string? ReferrerId { get; init; }

    /// <summary>The referred customer's user ID (wire <c>referee_customer_user_id</c>).</summary>
    public string? RefereeCustomerId { get; init; }

    /// <summary><c>in_progress</c>, <c>holding</c>, <c>qualified</c>, <c>disqualified</c> or <c>rejected</c>.</summary>
    public string? Status { get; init; }

    /// <summary>Why referrals were disqualified or rejected, e.g. <c>existing_user</c>.</summary>
    public string? Reason { get; init; }

    /// <summary>Created at or after.</summary>
    public DateTimeOffset? From { get; init; }

    /// <summary>Created before.</summary>
    public DateTimeOffset? To { get; init; }

    /// <summary>Page size, 1-100 (default 25).</summary>
    public int? Limit { get; init; }

    /// <summary><see cref="Referrals.ListPageAsync"/> only: the cursor of the page to fetch.</summary>
    public string? StartingAfter { get; init; }

    /// <summary><see cref="Referrals.ListPageAsync"/> only: fetch the page before this cursor.</summary>
    public string? EndingBefore { get; init; }

    internal Dictionary<string, object?> Query()
    {
        var q = new Dictionary<string, object?>();
        void Put(string k, object? v)
        {
            if (v is not null)
            {
                q[k] = v;
            }
        }
        Put("program_id", ProgramId);
        Put("referrer_id", ReferrerId);
        Put("referee_customer_user_id", RefereeCustomerId);
        Put("status", Status);
        Put("reason", Reason);
        Put("from", From is DateTimeOffset f ? Dates.Format(f) : null);
        Put("to", To is DateTimeOffset t ? Dates.Format(t) : null);
        Put("limit", Limit);
        Put("starting_after", StartingAfter);
        Put("ending_before", EndingBefore);
        return q;
    }
}

/// <summary>The parameters of <see cref="Referrals.CompleteStepAsync"/>: the goal step your server saw completed.</summary>
/// <example><code>new CompleteStepParams { Goal = "first_deposit", OccurredAt = deposit.CreatedAt, Value = 15_000m, Currency = "NGN" }</code></example>
public sealed record CompleteStepParams
{
    /// <summary>Required: the goal key of the referral's current step.</summary>
    public string Goal { get; init; } = string.Empty;

    /// <summary>Required: when the step's goal happened (the API needs it; unset is refused locally with <c>invalid_argument</c>).</summary>
    public DateTimeOffset? OccurredAt { get; init; }

    /// <summary>The value in normal units (<c>decimal</c>, <c>long</c> or a decimal string), when the step has a minimum value.</summary>
    public MoneyValue? Value { get; init; }

    /// <summary>ISO 4217, with the value.</summary>
    public string? Currency { get; init; }

    internal JsonObject Wire()
    {
        var goal = Requester.RequireId(Goal, "goal");
        var value = Value is MoneyValue v ? v.Wire : null;   // money errors (invalid_value) first, as in the other SDKs
        var occurredAt = OccurredAt ?? throw Errors.Local("invalid_argument", "OccurredAt is required: when the step's goal happened.", "occurred_at");
        var o = new JsonObject
        {
            ["goal"] = goal,
            ["occurred_at"] = Dates.Format(occurredAt),
        };
        if (value is not null)
        {
            o["value"] = value;
        }
        if (Currency is not null)
        {
            o["currency"] = Currency;
        }
        return o;
    }
}

/// <summary>One row of <see cref="Referrals.ImportReferrersAsync"/>.</summary>
/// <example><code>new ReferrerImport { CustomerId = "user_42", DisplayName = "Ada" }</code></example>
public sealed record ReferrerImport
{
    /// <summary>Required: your user's ID.</summary>
    public string CustomerId { get; init; } = string.Empty;

    /// <summary>Your own code for this referrer.</summary>
    public string? ExternalCode { get; init; }

    /// <summary>The name shown to the people they refer.</summary>
    public string? DisplayName { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject { ["customer_user_id"] = Requester.RequireId(CustomerId, "customer_id") };
        if (ExternalCode is not null)
        {
            o["external_code"] = ExternalCode;
        }
        if (DisplayName is not null)
        {
            o["display_name"] = DisplayName;
        }
        return o;
    }
}

/// <summary>
/// The changes of <see cref="Referrals.UpdateReferrerAsync"/>. Only the fields you set are sent; set
/// <see cref="ClearDisplayName"/> or <see cref="ClearAttributes"/> to clear one.
/// </summary>
/// <example><code>new UpdateReferrerParams { DisplayName = "Ada L." }</code></example>
public sealed record UpdateReferrerParams
{
    /// <summary>The name shown to the people they refer.</summary>
    public string? DisplayName { get; init; }

    /// <summary>Sends <c>display_name: null</c>.</summary>
    public bool ClearDisplayName { get; init; }

    /// <summary>Your own code for this referrer.</summary>
    public string? ExternalCode { get; init; }

    /// <summary>Sends <c>external_code: null</c>.</summary>
    public bool ClearExternalCode { get; init; }

    /// <summary>True hides the referrer from leaderboards.</summary>
    public bool? LeaderboardOptOut { get; init; }

    /// <summary>Your own keys on this referrer (replaces them).</summary>
    public IReadOnlyDictionary<string, object?>? Attributes { get; init; }

    /// <summary>Sends <c>attributes: null</c>.</summary>
    public bool ClearAttributes { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject();
        if (DisplayName is not null || ClearDisplayName)
        {
            o["display_name"] = DisplayName;
        }
        if (ExternalCode is not null || ClearExternalCode)
        {
            o["external_code"] = ExternalCode;
        }
        if (LeaderboardOptOut is bool optOut)
        {
            o["leaderboard_opt_out"] = optOut;
        }
        if (Attributes is not null || ClearAttributes)
        {
            o["attributes"] = Json.ToNode(Attributes);
        }
        return o;
    }
}

/// <summary>The parameters of <see cref="Privacy.CreateRequestAsync"/>.</summary>
/// <example><code>new CreatePrivacyRequestParams { Type = "erasure", SubjectType = "customer_user", SubjectId = user.Id }</code></example>
public sealed record CreatePrivacyRequestParams
{
    /// <summary>Required: <c>access</c>, <c>export</c>, <c>delete</c> or <c>erasure</c>.</summary>
    public string Type { get; init; } = string.Empty;

    /// <summary>Required: <c>installation</c>, <c>customer_user</c>, <c>email</c>, <c>phone</c>, <c>person</c> or <c>click</c>.</summary>
    public string SubjectType { get; init; } = string.Empty;

    /// <summary>Required: the subject's ID of that type.</summary>
    public string SubjectId { get; init; } = string.Empty;

    /// <summary>The app, for an installation subject.</summary>
    public string? AppId { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject
        {
            ["type"] = Requester.RequireId(Type, "type"),
            ["subject_type"] = Requester.RequireId(SubjectType, "subject_type"),
            ["subject_id"] = Requester.RequireId(SubjectId, "subject_id"),
        };
        if (AppId is not null)
        {
            o["app_id"] = AppId;
        }
        return o;
    }
}

/// <summary>The parameters of <see cref="Codes.RedeemAsync"/>: a code someone gave offline (USSD, SMS, an agent, a till).</summary>
/// <example><code>new RedeemCodeParams { ExternalId = "ussd-881", Code = "ADA42", Channel = "ussd" }</code></example>
public sealed record RedeemCodeParams
{
    /// <summary>Required: your ID for this redemption (the same ID is never counted twice).</summary>
    public string ExternalId { get; init; } = string.Empty;

    /// <summary>Required: the code as typed.</summary>
    public string Code { get; init; } = string.Empty;

    /// <summary>Required: <c>ussd</c>, <c>sms_keyword</c>, <c>agent</c>, <c>pos</c>, <c>in_store</c>, <c>call_center</c>, <c>event</c>, <c>print</c>, <c>radio</c> or <c>other</c>.</summary>
    public string Channel { get; init; } = string.Empty;

    /// <summary>The app.</summary>
    public string? AppId { get; init; }

    /// <summary>When it happened (defaults to now on the server).</summary>
    public DateTimeOffset? OccurredAt { get; init; }

    /// <summary>Your own keys.</summary>
    public IReadOnlyDictionary<string, object?>? Metadata { get; init; }

    /// <summary>Who used the code. A subject that maps to an install lets a referral code create a referral.</summary>
    public OfflineSubject? Subject { get; init; }

    /// <summary>The agent who took the code (up to 100 characters).</summary>
    public string? AgentId { get; init; }

    /// <summary>Where the code was used.</summary>
    public OfflineLocation? Location { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject
        {
            ["external_id"] = Requester.RequireId(ExternalId, "external_id"),
            ["code"] = Requester.RequireId(Code, "code"),
            ["channel"] = Requester.RequireId(Channel, "channel"),
        };
        if (Subject is not null)
        {
            o["subject"] = Subject.Wire();
        }
        if (AppId is not null)
        {
            o["app_id"] = AppId;
        }
        if (AgentId is not null)
        {
            o["agent_id"] = AgentId;
        }
        if (Location is not null)
        {
            o["location"] = Location.Wire();
        }
        if (OccurredAt is DateTimeOffset t)
        {
            o["occurred_at"] = Dates.Format(t);
        }
        if (Metadata is not null)
        {
            o["metadata"] = Json.ToNode(Metadata);
        }
        return o;
    }
}

/// <summary>Who used an offline code (<see cref="RedeemCodeParams.Subject"/>).</summary>
/// <example><code>new OfflineSubject { Type = "customer_user_id", Id = user.Id }</code></example>
public sealed record OfflineSubject
{
    /// <summary>Required: <c>installation_id</c>, <c>customer_user_id</c>, <c>external_customer_id</c>, <c>phone_hash</c> or <c>none</c>.</summary>
    public string Type { get; init; } = string.Empty;

    /// <summary>The subject's value of that type (none for <c>none</c>).</summary>
    public string? Id { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject { ["type"] = Requester.RequireId(Type, "subject.type") };
        if (Id is not null)
        {
            o["id"] = Id;
        }
        return o;
    }
}

/// <summary>Where an offline code was used (<see cref="RedeemCodeParams.Location"/>). Each part is optional.</summary>
public sealed record OfflineLocation
{
    /// <summary>ISO 3166-1 alpha-2.</summary>
    public string? Country { get; init; }

    /// <summary>The region or state.</summary>
    public string? Region { get; init; }

    /// <summary>The city.</summary>
    public string? City { get; init; }

    /// <summary>Your store's ID.</summary>
    public string? StoreId { get; init; }

    internal JsonObject Wire()
    {
        var o = new JsonObject();
        if (Country is not null)
        {
            o["country"] = Country;
        }
        if (Region is not null)
        {
            o["region"] = Region;
        }
        if (City is not null)
        {
            o["city"] = City;
        }
        if (StoreId is not null)
        {
            o["store_id"] = StoreId;
        }
        return o;
    }
}
