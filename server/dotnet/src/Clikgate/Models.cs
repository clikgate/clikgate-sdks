using System;
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

    /// <summary>One RFC 3339 timestamp field, or null.</summary>
    protected DateTimeOffset? Time(string key) =>
        String(key) is string s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) ? t : null;

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

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");

    /// <summary>When the event happened.</summary>
    public string? OccurredAt => String("occurred_at");

    /// <summary>Goal webhooks: the alias the event arrived as; null when sent as the goal's key.</summary>
    public string? ReceivedAs => String("received_as");

    /// <summary>Goal webhooks: true when this event made a new customer, else false or null.</summary>
    public bool? IsFirstCustomer => Bool("is_first_customer");

    /// <summary>Goal webhooks: when the attributed click happened, or null.</summary>
    public string? ClickedAt => String("clicked_at");

    /// <summary><c>goal.completed</c>: the event's person (<c>person.id</c>), or null.</summary>
    public string? PersonId => Raw["person"] is JsonObject p ? Json.Str(p["id"]) : null;

    /// <summary><c>goal.completed</c>: true for an event counted from the last 30 days when the goal was set up.</summary>
    public bool Backfilled => Bool("backfilled") ?? false;

    /// <summary>The link the event is attributed to: <c>link.id</c> in goal webhooks, <c>attributed_to.link_id</c> in API answers; null when unattributed.</summary>
    public string? LinkId => (Raw["link"] as JsonObject)?["id"] is JsonNode n ? Json.Str(n) : Json.Str(AttributedTo?["link_id"]);

    /// <summary>The campaign the event is attributed to: <c>campaign.id</c> in goal webhooks, <c>attributed_to.campaign_id</c> in API answers; null when none.</summary>
    public string? CampaignId => (Raw["campaign"] as JsonObject)?["id"] is JsonNode n ? Json.Str(n) : Json.Str(AttributedTo?["campaign_id"]);
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

    /// <summary>The domain, e.g. <c>ciz.to</c>.</summary>
    public string? Domain => String("domain");
    /// <summary>The domain group.</summary>
    public string? DomainGroupId => String("domain_group_id");
    /// <summary>The path after the domain.</summary>
    public string? Slug => String("slug");
    /// <summary>Where people go when the destination is not available, else null.</summary>
    public string? FallbackUrl => String("fallback_url");
    /// <summary>The click-ID query parameter added to the destination.</summary>
    public string? ClickIdParam => String("click_id_param");
    /// <summary>The UTM template, else null.</summary>
    public string? UtmTemplate => String("utm_template");
    /// <summary>The campaign, else null.</summary>
    public string? CampaignId => String("campaign_id");
    /// <summary>The goal this link is meant to lead to, else null.</summary>
    public string? EndGoalKey => String("end_goal_key");
    /// <summary>The title, else null.</summary>
    public string? Title => String("title");
    /// <summary>The preview title.</summary>
    public string? OgTitle => String("og_title");
    /// <summary>The preview description.</summary>
    public string? OgDescription => String("og_description");
    /// <summary>The preview image.</summary>
    public string? OgImageUrl => String("og_image_url");
    /// <summary>Why the link is paused, else null.</summary>
    public string? PausedReason => String("paused_reason");
    /// <summary><c>standard</c> or <c>whatsapp</c>.</summary>
    public string? Kind => String("kind");
    /// <summary>The in-app path the app opens, else null.</summary>
    public string? DeepLinkPath => String("deep_link_path");
    /// <summary><c>app_or_store</c>, <c>app_or_web</c> or <c>web_only</c>.</summary>
    public string? AppBehavior => String("app_behavior");
    /// <summary><c>auto</c>, <c>always</c> or <c>never</c>.</summary>
    public string? IosInterstitial => String("ios_interstitial");
    /// <summary>Set on a referrer's link.</summary>
    public string? ReferralProgramId => String("referral_program_id");
    /// <summary>Set on a referrer's link.</summary>
    public string? ReferrerId => String("referrer_id");
    /// <summary>The WhatsApp channel, else null.</summary>
    public string? WhatsappChannelId => String("whatsapp_channel_id");
    /// <summary>The prefilled WhatsApp message, else null.</summary>
    public string? WhatsappMessage => String("whatsapp_message");
    /// <summary>The code people can type instead of clicking, else null.</summary>
    public string? OfflineCode => String("offline_code");
    /// <summary>Who locked the link, else null.</summary>
    public string? LockedBy => String("locked_by");
    /// <summary><c>auto</c> or <c>off</c>.</summary>
    public string? OpenInApp => String("open_in_app");
    /// <summary><c>inherit</c>, <c>on</c> or <c>off</c>.</summary>
    public string? InAppBrowserPage => String("in_app_browser_page");
    /// <summary>Where the link is meant to be shared (<c>whatsapp</c>, <c>instagram</c>, …), else null.</summary>
    public string? MadeFor => String("made_for");
    /// <summary>A suggested improvement (e.g. <c>make_whatsapp_link</c>), else null.</summary>
    public string? Suggestion => String("suggestion");
    /// <summary>The link on each active domain of its group (<c>domain</c>, <c>url</c>, <c>role</c>).</summary>
    public IReadOnlyList<JsonObject> Urls => (Raw["urls"] as JsonArray ?? []).OfType<JsonObject>().ToList();

    /// <summary>Days a click can be credited for a goal.</summary>
    public int? AttributionWindowDays => Json.Int(Raw["attribution_window_days"]);

    /// <summary>Tags.</summary>
    public IReadOnlyList<string> Tags => (Raw["tags"] as JsonArray ?? []).Select(Json.Str).OfType<string>().ToList();

    /// <summary>When the link stops working, else null.</summary>
    public DateTimeOffset? ExpiresAt => Time("expires_at");

    /// <summary>The apps this link opens.</summary>
    public IReadOnlyList<string> AppIds => (Raw["app_ids"] as JsonArray ?? []).Select(Json.Str).OfType<string>().ToList();

    /// <summary>Your own data the app receives with the deep link (<c>deep_link_data</c>); empty when none.</summary>
    public JsonObject DeepLinkData => Raw["deep_link_data"] as JsonObject ?? new JsonObject();

    /// <summary>True on a free domain link kept on a paid domain.</summary>
    public bool LegacyFreeOnPaidDomain => Bool("legacy_free_on_paid_domain") ?? false;

    /// <summary>True while the link waits for a review (it doesn't redirect).</summary>
    public bool UnderReview => Bool("under_review") ?? false;

    /// <summary>When the link was locked, else null.</summary>
    public DateTimeOffset? LockedAt => Time("locked_at");

    /// <summary>The app page this link opens in place of a web page (<c>app_key</c>, <c>app_name</c>, <c>page_type</c>, <c>status</c>), else null.</summary>
    public JsonObject? OpenInAppTarget => Raw["open_in_app_target"] as JsonObject;

    /// <summary>One URL per sharing channel (<c>whatsapp</c>, <c>instagram</c>, …); empty when none.</summary>
    public IReadOnlyDictionary<string, string> ShareUrls =>
        (Raw["share_urls"] as JsonObject ?? new JsonObject()).Where(kv => Json.Str(kv.Value) is not null).ToDictionary(kv => kv.Key, kv => Json.Str(kv.Value)!, StringComparer.Ordinal);

    /// <summary>Created.</summary>
    public DateTimeOffset? CreatedAt => Time("created_at");

    /// <summary>Last changed.</summary>
    public DateTimeOffset? UpdatedAt => Time("updated_at");

    /// <summary>True in live mode.</summary>
    public bool? Livemode => Bool("livemode");
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

    /// <summary>Your ID for the conversion (<c>external_id</c>).</summary>
    public string? ExternalId => String("external_id");

    /// <summary><c>purchase</c>, <c>signup</c>, …</summary>
    public string? Type => String("type");

    /// <summary>The amount in the currency's minor units, or null.</summary>
    public long? AmountMinor => Raw["amount_minor"] is JsonValue v && v.TryGetValue(out long l) ? l : null;

    /// <summary><see cref="AmountMinor"/> in normal units (exact, ISO 4217 decimals), or null.</summary>
    public decimal? Amount => Currencies.ToNormalUnits(AmountMinor, Currency);

    /// <summary>ISO 4217.</summary>
    public string? Currency => String("currency");

    /// <summary>The click.</summary>
    public string? ClickId => String("click_id");

    /// <summary>The goal, when the conversion was recorded for one.</summary>
    public string? Goal => String("goal");

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

/// <summary>
/// A webhook event. Read <c>data.object</c> typed with <see cref="AsReferral"/>, <see cref="AsReferrer"/>,
/// <see cref="AsGoalEvent"/>, <see cref="AsInstall"/>, <see cref="AsPayment"/>, <see cref="AsConversion"/> or <see cref="AsDeviceChange"/>: each returns
/// null when the event's type belongs to another family (or <c>data.object</c> isn't an object), like the <c>as</c> operator.
/// </summary>
/// <example><code>
/// var ev = Webhooks.Verify(body, signature, secret);
/// if (ev.Type == EventType.REFERRAL_QUALIFIED &amp;&amp; ev.AsReferral() is { } referral) { /* … */ }
/// </code></example>
public sealed class WebhookEvent(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The event ID (dedupe on it: delivery is at-least-once).</summary>
    public string? Id => String("id");

    /// <summary>The event type, e.g. <see cref="EventType.REFERRAL_QUALIFIED"/>.</summary>
    public string? Type => String("type");

    /// <summary>The API version the payload is shaped for.</summary>
    public string? ApiVersion => String("api_version");

    /// <summary>When the event happened.</summary>
    public DateTimeOffset? CreatedAt => String("created_at") is string s && DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var t) ? t : null;

    /// <summary>The organisation.</summary>
    public string? OrganizationId => String("organization_id");

    /// <summary>True for live-mode events.</summary>
    public bool? Livemode => Bool("livemode");

    /// <summary><c>object</c> plus the event's extra keys.</summary>
    public JsonObject? Data => Raw["data"] as JsonObject;

    /// <summary>The referral of a <c>referral.*</c> event; null for another type.</summary>
    public Referral? AsReferral() => Typed("referral.", o => new Referral(o));

    /// <summary>The referrer of a <c>referrer.*</c> event; null for another type.</summary>
    public Referrer? AsReferrer() => Typed("referrer.", o => new Referrer(o));

    /// <summary>The goal event of <c>goal.completed</c> or <c>goal.reversed</c> (<c>Data["reversal"]</c> has the reversal); null for another type.</summary>
    public GoalEvent? AsGoalEvent() => Typed("goal.", o => new GoalEvent(o));

    /// <summary>The install of an <c>install.*</c> event; null for another type.</summary>
    public Install? AsInstall() => Typed("install.", o => new Install(o));

    /// <summary>The payment report of a <c>payment.*</c> event; null for another type.</summary>
    public PaymentReport? AsPayment() => Typed("payment.", o => new PaymentReport(o));

    /// <summary>The conversion of a <c>conversion.*</c> event; null for another type.</summary>
    public Conversion? AsConversion() => Typed("conversion.", o => new Conversion(o));

    /// <summary>The device change of a <c>person.device_changed</c> event; null for another type.</summary>
    public DeviceChange? AsDeviceChange() => Type == EventType.PERSON_DEVICE_CHANGED ? Typed("person.device_changed", o => new DeviceChange(o)) : null;

    private T? Typed<T>(string prefix, Func<JsonObject, T> make)
        where T : class =>
        Type is string type && type.StartsWith(prefix, StringComparison.Ordinal) && Data?["object"] is JsonObject o ? make(o) : null;
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
    /// <summary>The parameters for an installation parsed with <see cref="Clikgate.Installation.ParseHeader"/>.</summary>
    /// <example><code>await clikgate.IdentifyUserAsync(IdentifyUserParams.For(installation, user.Id));</code></example>
    public static IdentifyUserParams For(global::Clikgate.Installation installation, string? customerId = null)
    {
        if (installation is null) throw new ArgumentNullException(nameof(installation));
        return new() { AppId = installation.AppId, InstallationId = installation.InstallationId, CustomerId = customerId };
    }

    /// <summary>The Clikgate click ID you kept (<c>clk_…</c>).</summary>
    public string? ClickId { get; set; }

    /// <summary>
    /// The raw <c>Clikgate-Installation</c> header your app sent (<c>&lt;app_id&gt;:&lt;installation_id&gt;</c>). It fills
    /// <see cref="AppId"/> and <see cref="InstallationId"/>. Missing or invalid values are ignored, never sent. Not used
    /// when <see cref="InstallationId"/> is given.
    /// </summary>
    public string? Installation { get; set; }

    /// <summary>The app the installation belongs to. Optional: without it Clikgate finds the app. Only with <see cref="InstallationId"/>.</summary>
    public string? AppId { get; set; }

    /// <summary>The SDK's installation ID, sent by your app.</summary>
    public string? InstallationId { get; set; }

    /// <summary>
    /// Your signed-in user's ID (never a value read from the request). With a click or installation, links it to this
    /// customer. Refused in private mode.
    /// </summary>
    public string? CustomerId { get; set; }

    /// <summary>A label your team sees instead of the click ID (1-80 characters, <c>""</c> clears it; Growth and up).</summary>
    public string? Label { get; set; }

    /// <summary>
    /// When this customer became your customer. Needs <see cref="CustomerId"/>. Clikgate keeps the
    /// earliest date it gets. Refused in private mode.
    /// </summary>
    public DateTimeOffset? CustomerSince { get; set; }

    /// <summary><c>true</c> lets <see cref="CustomerSince"/> move a wrong date later (audit-logged). Default: the earliest date is kept.</summary>
    public bool CustomerSinceReplace { get; set; }
}

/// <summary>The answer of <see cref="ClikgateClient.IdentifyUserAsync"/> (<c>object: "person_identified"</c>).</summary>
public sealed class PersonIdentified(JsonObject? raw) : WireObject(raw)
{
    /// <summary>The person (<c>per_…</c>).</summary>
    public string? PersonId => String("person_id");

    /// <summary><c>plan</c> (below Growth the label isn't stored), <c>lower_rank</c> (a label your team set was kept), or null.</summary>
    public string? LabelIgnored => String("label_ignored");

    /// <summary>Why <c>CustomerSince</c> wasn't used: <c>unverified</c> or <c>invalid</c>, or null.</summary>
    public string? CustomerSinceIgnored => String("customer_since_ignored");

    /// <summary><c>looks_like_email</c>, <c>looks_like_phone</c> or <c>looks_like_national_id</c>: use your own user ID instead. Null otherwise.</summary>
    public string? CustomerIdWarning => String("customer_id_warning");
}
