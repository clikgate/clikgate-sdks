using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json.Nodes;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>A wire object (the API's JSON, <c>snake_case</c> keys) with typed properties. <see cref="Raw"/> keeps every field.</summary>
public class WireObject
{
    /// <summary>Wraps a JSON object.</summary>
    public WireObject(JsonObject? raw) => Raw = raw ?? new JsonObject();

    /// <summary>Every field, as the API sent it.</summary>
    public JsonObject Raw { get; }

    /// <summary>One string field.</summary>
    protected string? String(string key) => Json.Str(Raw[key]);

    /// <summary>One boolean field.</summary>
    protected bool? Bool(string key) => Json.Bool(Raw[key]);

    /// <inheritdoc/>
    public override string ToString() => Raw.ToJsonString();
}

/// <summary>A goal event (<c>POST /v1/goals/events</c>).</summary>
public sealed class GoalEvent(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The event ID.</summary>
    public string? Id => String("id");

    /// <summary>
    /// The outcome of the call: <see cref="GoalStatus.COUNTED"/>, <see cref="GoalStatus.WAITING"/> (a Payment goal waiting
    /// for its confirmation, or a goal waiting for its click) or <see cref="GoalStatus.REFUSED"/>; null for a status this SDK
    /// version doesn't know (<c>Raw["status"]</c> has the wire string).
    /// </summary>
    public GoalStatus? Status => ClikgateEnums.ParseGoalStatus(String("status"));

    /// <summary>The goal's kind, <see cref="Clikgate.GoalKind.STANDARD"/> or <see cref="Clikgate.GoalKind.PAYMENT"/>; null when unknown to this SDK version.</summary>
    public GoalKind? GoalKind => ClikgateEnums.ParseGoalKind(String("goal_kind"));

    /// <summary>The attribution state: <c>attributed</c>, <c>unattributed</c>, <c>rejected_bot</c>, … (null while a Payment goal waits).</summary>
    public string? EventStatus => String("event_status");

    /// <summary>True when the value was dropped (a browser or app sent a value for a Payment goal).</summary>
    public bool ValueIgnored => Bool("value_ignored") ?? false;

    /// <summary>For a Payment goal sent by your server: <c>confirmation_id</c>, <c>match_status</c>, <c>report_id</c>, <c>provider</c>; else null.</summary>
    public JsonObject? Payment => Raw["payment"] as JsonObject;

    /// <summary>The goal key.</summary>
    public string? Goal => String("goal");

    /// <summary>Your reference; null in private mode.</summary>
    public string? Reference => String("reference");

    /// <summary>Normal units as a decimal string, e.g. <c>"2000000"</c>.</summary>
    public string? Value => String("value");

    /// <summary><see cref="Value"/> as a decimal.</summary>
    public decimal? ValueDecimal => Value is null ? null : decimal.Parse(Value, NumberStyles.Number, CultureInfo.InvariantCulture);

    /// <summary>The same amount in the currency's minor units (kobo, cents), e.g. <c>200000000</c>;
    /// null without a value.</summary>
    public long? ValueMinor => Long("value_minor");

    /// <summary>The reversed amount in normal units as a decimal string, or null when nothing was reversed.</summary>
    public string? ReversedValue => String("reversed_value");

    /// <summary><see cref="ReversedValue"/> in minor units, or null.</summary>
    public long? ReversedValueMinor => Long("reversed_value_minor");

    private long? Long(string key) => Raw[key] is JsonValue v && v.TryGetValue(out long l) ? l : null;

    /// <summary>ISO 4217.</summary>
    public string? Currency => String("currency");

    /// <summary>Whether this event counts in totals: the same as <c>Status == GoalStatus.COUNTED</c>.</summary>
    public bool Counted => Bool("counted") ?? false;

    /// <summary>Null when counted; else why, e.g. <c>waiting_for_confirmation</c>, <c>already_counted_for_click</c> (a plain string: new reasons can appear).</summary>
    public string? Reason => String("reason");

    /// <summary>First event for the click.</summary>
    public bool? FirstForClick => Bool("first_for_click");

    /// <summary><c>link_id</c>, <c>campaign_id</c>, <c>clicked_at</c>, or null when unattributed.</summary>
    public JsonObject? AttributedTo => Raw["attributed_to"] as JsonObject;
}

/// <summary>One item of a batch result.</summary>
public sealed class GoalBatchItem(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The event's position in the batch.</summary>
    public int Index => Json.Int(Raw["index"]) ?? -1;

    /// <summary>Whether it was accepted.</summary>
    public bool Ok => Bool("ok") ?? false;

    /// <summary>The HTTP status it would have had alone.</summary>
    public int Status => Json.Int(Raw["status"]) ?? 0;

    /// <summary>The goal event when <see cref="Ok"/>.</summary>
    public GoalEvent? GoalEvent => Raw["goal_event"] is JsonObject o ? new GoalEvent(o) : null;

    /// <summary>The error envelope when not <see cref="Ok"/>.</summary>
    public JsonObject? Error => Raw["error"] as JsonObject;
}

/// <summary><c>POST /v1/goals/events/batch</c>: one item per event, in order.</summary>
public sealed class GoalBatchResult(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The items.</summary>
    public IReadOnlyList<GoalBatchItem> Data => (Raw["data"] as JsonArray ?? []).Select(n => new GoalBatchItem(n as JsonObject)).ToList();
}

/// <summary>A link (<c>/v1/links</c>).</summary>
public sealed class Link(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The link ID.</summary>
    public string? Id => String("id");

    /// <summary>The short URL.</summary>
    public string? ShortUrl => String("short_url");

    /// <summary>The destination.</summary>
    public string? DestinationUrl => String("destination_url");

    /// <summary>The status.</summary>
    public string? Status => String("status");

    /// <summary><c>"premium"</c> on <c>ciz.to</c> links, else null.</summary>
    public string? DomainBadge => String("domain_badge");

    /// <summary>Your own ID for this link (<c>external_reference</c>), else null.</summary>
    public string? ExternalReference => String("external_reference");

    /// <summary>
    /// Your own keys on this link (<c>metadata</c>, e.g. <c>seller_id</c>); empty when it has none. Results can be
    /// grouped (<c>group_by=metadata.&lt;key&gt;</c>) and filtered (<c>metadata[&lt;key&gt;]</c>) by them.
    /// </summary>
    public JsonObject Metadata => Raw["metadata"] as JsonObject ?? new JsonObject();

    /// <summary>True when destination, fallback and deep-link changes are refused (<c>409 link_locked</c>).</summary>
    public bool Locked => Bool("locked") ?? false;

    /// <summary>Non-blocking warnings (<c>code</c>, <c>message</c>, <c>param</c>), e.g. <c>no_preview</c>.</summary>
    public IReadOnlyList<JsonObject> Warnings => (Raw["warnings"] as JsonArray ?? []).OfType<JsonObject>().ToList();
}

/// <summary>A destination change waiting for a second person (the <c>202</c> answer of <c>Links.UpdateAsync</c>).</summary>
public sealed class LinkChangeRequest(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The change request ID (<c>lcr_…</c>).</summary>
    public string? Id => String("id");

    /// <summary>The link.</summary>
    public string? LinkId => String("link_id");

    /// <summary><c>pending</c>, <c>approved</c>, <c>rejected</c> or <c>expired</c>.</summary>
    public string? Status => String("status");

    /// <summary>The current destination.</summary>
    public string? FromUrl => String("from_url");

    /// <summary>The requested destination.</summary>
    public string? ToUrl => String("to_url");
}

/// <summary>The result of <c>Links.UpdateAsync</c>: applied now, or waiting for approval.</summary>
public sealed class LinkUpdateResult(bool applied, Link? link, LinkChangeRequest? changeRequest)
{
    /// <summary>True when applied (<c>200</c>); false when it waits for approval (<c>202</c>).</summary>
    public bool Applied { get; } = applied;

    /// <summary>The link when applied.</summary>
    public Link? Link { get; } = link;

    /// <summary>The change request when not applied.</summary>
    public LinkChangeRequest? ChangeRequest { get; } = changeRequest;

    /// <summary>The link's warnings (empty for a change request).</summary>
    public IReadOnlyList<JsonObject> Warnings => Link?.Warnings ?? [];

    /// <summary><c>{applied, link, change_request, warnings}</c>, as the other SDKs return it.</summary>
    public JsonObject ToJson() => new()
    {
        ["applied"] = Applied,
        ["link"] = Link?.Raw.DeepClone(),
        ["change_request"] = ChangeRequest?.Raw.DeepClone(),
        ["warnings"] = new JsonArray(Warnings.Select(w => (JsonNode)w.DeepClone()).ToArray()),
    };
}

/// <summary>One page of links.</summary>
public sealed class LinkPage(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The links.</summary>
    public IReadOnlyList<Link> Data => (Raw["data"] as JsonArray ?? []).Select(n => new Link(n as JsonObject)).ToList();

    /// <summary>Whether another page exists.</summary>
    public bool HasMore => Bool("has_more") ?? false;

    /// <summary>The cursor of the next page.</summary>
    public string? NextCursor => String("next_cursor");
}

/// <summary>A click.</summary>
public sealed class Click(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The click ID.</summary>
    public string? Id => String("id");

    /// <summary>The country.</summary>
    public string? Country => String("country");
}

/// <summary>A conversion (older API).</summary>
public sealed class Conversion(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The conversion ID.</summary>
    public string? Id => String("id");

    /// <summary>The status.</summary>
    public string? Status => String("status");

    /// <summary><c>conversion</c>, or <c>goal_event</c> when the conversion was for a Payment goal.</summary>
    public string? Object => String("object");

    /// <summary>Whether the API answered with the goal event (a Payment goal): read it with <see cref="AsGoalEvent"/>.</summary>
    public bool IsGoalEvent => Object == "goal_event";

    /// <summary>The same answer read as a <see cref="GoalEvent"/> (meaningful when <see cref="IsGoalEvent"/>).</summary>
    public GoalEvent AsGoalEvent() => new(Raw);
}

/// <summary><c>GET /v1/server-sdk/config</c>.</summary>
public sealed class ServerSdkConfig(JsonObject? raw) : WireObject(raw)
{
    /// <summary>Whether private mode is on.</summary>
    public bool PrivateMode => Bool("private_mode") ?? false;

    /// <summary>The organisation's click-ID parameter.</summary>
    public string? ClickIdParam => String("click_id_param");

    /// <summary>The goals (<c>key</c>, <c>value_mode</c>, <c>default_currency</c>).</summary>
    public IReadOnlyList<JsonObject> Goals => (Raw["goals"] as JsonArray ?? []).OfType<JsonObject>().ToList();

    /// <summary>The minimum version of an SDK, or null.</summary>
    public string? MinimumVersion(string sdk) => Raw["minimum_sdk_versions"] is JsonObject o ? Json.Str(o[sdk]) : null;
}

/// <summary>A webhook event.</summary>
public sealed class WebhookEvent(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The event ID (dedupe on it: delivery is at-least-once).</summary>
    public string? Id => String("id");

    /// <summary>e.g. <c>goal.completed</c>, <c>link.destination_changed</c>, <c>subscription.updated</c>.</summary>
    public string? Type => String("type");

    /// <summary><c>object</c> plus the event's extra keys.</summary>
    public JsonObject? Data => Raw["data"] as JsonObject;
}

/// <summary>Binary bytes and their content type (QR codes, file downloads).</summary>
public sealed class BinaryResponse(string contentType, byte[] data)
{
    /// <summary>The content type.</summary>
    public string ContentType { get; } = contentType;

    /// <summary>The bytes.</summary>
    public byte[] Data { get; } = data;
}

/// <summary>The parameters of <see cref="ClikgateClient.IdentifyUserAsync"/>: at least one of <c>ClickId</c>, <c>AppId</c> + <c>InstallationId</c>, <c>CustomerId</c>.</summary>
public sealed class IdentifyUserParams
{
    /// <summary>The Clikgate click ID you kept (<c>clk_…</c>).</summary>
    public string? ClickId { get; set; }

    /// <summary>An app installation: the app's ID, with <see cref="InstallationId"/>.</summary>
    public string? AppId { get; set; }

    /// <summary>The SDK's installation ID, with <see cref="AppId"/>.</summary>
    public string? InstallationId { get; set; }

    /// <summary>Your customer ID. With a click or installation, links it to this customer. Refused in private mode.</summary>
    public string? CustomerId { get; set; }

    /// <summary>A label your team sees instead of the click ID (1-80 characters, <c>""</c> clears it; Growth and up).</summary>
    public string? Label { get; set; }
}

/// <summary>The answer of <see cref="ClikgateClient.IdentifyUserAsync"/> (<c>object: "person_identified"</c>).</summary>
public sealed class PersonIdentified(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The person (<c>per_…</c>).</summary>
    public string? PersonId => String("person_id");

    /// <summary><c>plan</c> (below Growth the label isn't stored), <c>lower_rank</c> (a label your team set was kept), or null.</summary>
    public string? LabelIgnored => String("label_ignored");
}
