using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json.Nodes;
using Clikgate.Internal;

namespace Clikgate;

/// <summary>The parameters of <see cref="Links.CreateAsync(LinkCreateParams, RequestOptions?, System.Threading.CancellationToken)"/> (<c>CreateLink</c>). Properties left unset (or null) are not sent, so the API's defaults apply.</summary>
/// <example><code>var link = await clikgate.Links.CreateAsync(new LinkCreateParams { DestinationUrl = "https://example.com/spring", OgTitle = "Spring sale" });</code></example>
public sealed record LinkCreateParams
{
    private readonly Dictionary<string, object?> _fields = new(StringComparer.Ordinal);

    /// <summary>Empty parameters.</summary>
    public LinkCreateParams()
    {
    }

    private LinkCreateParams(LinkCreateParams original) => _fields = new Dictionary<string, object?>(original._fields, StringComparer.Ordinal);

    /// <summary>The domain, e.g. <c>ciz.to</c>.</summary>
    public string? Domain
    {
        get => Get<string?>("domain");
        init => Set("domain", value);
    }

    /// <summary>The path after the domain.</summary>
    public string? Slug
    {
        get => Get<string?>("slug");
        init => Set("slug", value);
    }

    /// <summary>Where the link goes (a full URL, or <c>clikgate-test:&lt;page&gt;</c> with a test key).</summary>
    public string? DestinationUrl
    {
        get => Get<string?>("destination_url");
        init => Set("destination_url", value);
    }

    /// <summary>Where people go when the destination is not available.</summary>
    public string? FallbackUrl
    {
        get => Get<string?>("fallback_url");
        init => Set("fallback_url", value);
    }

    /// <summary><c>title</c>.</summary>
    public string? Title
    {
        get => Get<string?>("title");
        init => Set("title", value);
    }

    /// <summary><c>og_title</c>.</summary>
    public string? OgTitle
    {
        get => Get<string?>("og_title");
        init => Set("og_title", value);
    }

    /// <summary><c>og_description</c>.</summary>
    public string? OgDescription
    {
        get => Get<string?>("og_description");
        init => Set("og_description", value);
    }

    /// <summary><c>og_image_url</c>.</summary>
    public string? OgImageUrl
    {
        get => Get<string?>("og_image_url");
        init => Set("og_image_url", value);
    }

    /// <summary><c>click_id_param</c>.</summary>
    public string? ClickIdParam
    {
        get => Get<string?>("click_id_param");
        init => Set("click_id_param", value);
    }

    /// <summary><c>utm_template</c>.</summary>
    public string? UtmTemplate
    {
        get => Get<string?>("utm_template");
        init => Set("utm_template", value);
    }

    /// <summary><c>attribution_window_days</c>.</summary>
    public int? AttributionWindowDays
    {
        get => Get<int?>("attribution_window_days");
        init => Set("attribution_window_days", value);
    }

    /// <summary>Your own ID for this link.</summary>
    public string? ExternalReference
    {
        get => Get<string?>("external_reference");
        init => Set("external_reference", value);
    }

    /// <summary><c>campaign_id</c>.</summary>
    public string? CampaignId
    {
        get => Get<string?>("campaign_id");
        init => Set("campaign_id", value);
    }

    /// <summary><c>campaign_external_reference</c>.</summary>
    public string? CampaignExternalReference
    {
        get => Get<string?>("campaign_external_reference");
        init => Set("campaign_external_reference", value);
    }

    /// <summary><c>end_goal_key</c>.</summary>
    public string? EndGoalKey
    {
        get => Get<string?>("end_goal_key");
        init => Set("end_goal_key", value);
    }

    /// <summary><c>tags</c>.</summary>
    public IReadOnlyList<string>? Tags
    {
        get => Get<IReadOnlyList<string>?>("tags");
        init => Set("tags", value);
    }

    /// <summary>Your own keys on this link (e.g. <c>seller_id</c>): group and filter results by them.</summary>
    public IReadOnlyDictionary<string, object?>? Metadata
    {
        get => Get<IReadOnlyDictionary<string, object?>?>("metadata");
        init => Set("metadata", value);
    }

    /// <summary>When the link stops working.</summary>
    public DateTimeOffset? ExpiresAt
    {
        get => _fields.TryGetValue("expires_at", out var v) && v is string s ? DateTimeOffset.Parse(s, CultureInfo.InvariantCulture) : null;
        init => Set("expires_at", value is DateTimeOffset d ? Dates.Format(d) : null);
    }

    /// <summary>Routing rules (<c>priority</c>, <c>conditions</c>, <c>destination_type</c>, …), with the API's field names.</summary>
    public IReadOnlyList<IReadOnlyDictionary<string, object?>>? Rules
    {
        get => Get<IReadOnlyList<IReadOnlyDictionary<string, object?>>?>("rules");
        init => Set("rules", value);
    }

    /// <summary><c>app_ids</c>.</summary>
    public IReadOnlyList<string>? AppIds
    {
        get => Get<IReadOnlyList<string>?>("app_ids");
        init => Set("app_ids", value);
    }

    /// <summary><c>deep_link_path</c>.</summary>
    public string? DeepLinkPath
    {
        get => Get<string?>("deep_link_path");
        init => Set("deep_link_path", value);
    }

    /// <summary>Your own data the app receives with the deep link.</summary>
    public IReadOnlyDictionary<string, object?>? DeepLinkData
    {
        get => Get<IReadOnlyDictionary<string, object?>?>("deep_link_data");
        init => Set("deep_link_data", value);
    }

    /// <summary><c>app_or_store</c>, <c>app_or_web</c> or <c>web_only</c>.</summary>
    public string? AppBehavior
    {
        get => Get<string?>("app_behavior");
        init => Set("app_behavior", value);
    }

    /// <summary><c>auto</c>, <c>always</c> or <c>never</c>.</summary>
    public string? IosInterstitial
    {
        get => Get<string?>("ios_interstitial");
        init => Set("ios_interstitial", value);
    }

    /// <summary><c>standard</c> or <c>whatsapp</c>.</summary>
    public string? Kind
    {
        get => Get<string?>("kind");
        init => Set("kind", value);
    }

    /// <summary><c>whatsapp_channel_id</c>.</summary>
    public string? WhatsappChannelId
    {
        get => Get<string?>("whatsapp_channel_id");
        init => Set("whatsapp_channel_id", value);
    }

    /// <summary><c>whatsapp_message</c>.</summary>
    public string? WhatsappMessage
    {
        get => Get<string?>("whatsapp_message");
        init => Set("whatsapp_message", value);
    }

    /// <summary><c>offline_code</c>.</summary>
    public string? OfflineCode
    {
        get => Get<string?>("offline_code");
        init => Set("offline_code", value);
    }

    /// <summary><c>auto</c> or <c>off</c>.</summary>
    public string? OpenInApp
    {
        get => Get<string?>("open_in_app");
        init => Set("open_in_app", value);
    }

    /// <summary><c>inherit</c>, <c>on</c> or <c>off</c>.</summary>
    public string? InAppBrowserPage
    {
        get => Get<string?>("in_app_browser_page");
        init => Set("in_app_browser_page", value);
    }

    /// <summary><c>whatsapp</c>, <c>instagram</c>, <c>facebook</c>, <c>tiktok</c>, <c>x</c>, <c>linkedin</c>, <c>sms</c>, <c>telegram</c>, <c>email</c>, <c>youtube</c> or <c>qr</c>.</summary>
    public string? MadeFor
    {
        get => Get<string?>("made_for");
        init => Set("made_for", value);
    }

    /// <summary>Fields this SDK version doesn't have a property for yet, with their API names.</summary>
    public IReadOnlyDictionary<string, object?>? Extra
    {
        get => null;
        init
        {
            foreach (var kv in value ?? new Dictionary<string, object?>())
            {
                Set(kv.Key, kv.Value);
            }
        }
    }

    /// <summary>The request body, with the API's field names.</summary>
    public JsonObject ToJson() => Json.ToNode(_fields) as JsonObject ?? [];

    private T? Get<T>(string key) => _fields.TryGetValue(key, out var v) && v is T t ? t : default;

    private void Set(string key, object? value)
    {
        if (value is null)
        {
            _fields.Remove(key);
        }
        else
        {
            _fields[key] = value;
        }
    }

    /// <inheritdoc/>
    public bool Equals(LinkCreateParams? other) => other is not null && JsonNode.DeepEquals(ToJson(), other.ToJson());

    /// <inheritdoc/>
    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(ToJson().ToJsonString());

    /// <inheritdoc/>
    public override string ToString() => ToJson().ToJsonString();
}

/// <summary>The changes of <see cref="Links.UpdateAsync(string, LinkUpdateParams, RequestOptions?, System.Threading.CancellationToken)"/> (<c>UpdateLink</c>). Only the properties you set are sent; setting one to null clears that field.</summary>
/// <example><code>await clikgate.Links.UpdateAsync(linkId, new LinkUpdateParams { DestinationUrl = "https://example.com/summer" });</code></example>
public sealed record LinkUpdateParams
{
    private readonly Dictionary<string, object?> _fields = new(StringComparer.Ordinal);

    /// <summary>Empty parameters.</summary>
    public LinkUpdateParams()
    {
    }

    private LinkUpdateParams(LinkUpdateParams original) => _fields = new Dictionary<string, object?>(original._fields, StringComparer.Ordinal);

    /// <summary>Where the link goes (a full URL, or <c>clikgate-test:&lt;page&gt;</c> with a test key).</summary>
    public string? DestinationUrl
    {
        get => Get<string?>("destination_url");
        init => Set("destination_url", value);
    }

    /// <summary>Where people go when the destination is not available.</summary>
    public string? FallbackUrl
    {
        get => Get<string?>("fallback_url");
        init => Set("fallback_url", value);
    }

    /// <summary><c>title</c>.</summary>
    public string? Title
    {
        get => Get<string?>("title");
        init => Set("title", value);
    }

    /// <summary><c>og_title</c>.</summary>
    public string? OgTitle
    {
        get => Get<string?>("og_title");
        init => Set("og_title", value);
    }

    /// <summary><c>og_description</c>.</summary>
    public string? OgDescription
    {
        get => Get<string?>("og_description");
        init => Set("og_description", value);
    }

    /// <summary><c>og_image_url</c>.</summary>
    public string? OgImageUrl
    {
        get => Get<string?>("og_image_url");
        init => Set("og_image_url", value);
    }

    /// <summary><c>tags</c>.</summary>
    public IReadOnlyList<string>? Tags
    {
        get => Get<IReadOnlyList<string>?>("tags");
        init => Set("tags", value);
    }

    /// <summary>Your own keys on this link (e.g. <c>seller_id</c>): group and filter results by them.</summary>
    public IReadOnlyDictionary<string, object?>? Metadata
    {
        get => Get<IReadOnlyDictionary<string, object?>?>("metadata");
        init => Set("metadata", value);
    }

    /// <summary><c>attribution_window_days</c>.</summary>
    public int? AttributionWindowDays
    {
        get => Get<int?>("attribution_window_days");
        init => Set("attribution_window_days", value);
    }

    /// <summary><c>utm_template</c>.</summary>
    public string? UtmTemplate
    {
        get => Get<string?>("utm_template");
        init => Set("utm_template", value);
    }

    /// <summary>When the link stops working.</summary>
    public DateTimeOffset? ExpiresAt
    {
        get => _fields.TryGetValue("expires_at", out var v) && v is string s ? DateTimeOffset.Parse(s, CultureInfo.InvariantCulture) : null;
        init => Set("expires_at", value is DateTimeOffset d ? Dates.Format(d) : null);
    }

    /// <summary><c>campaign_id</c>.</summary>
    public string? CampaignId
    {
        get => Get<string?>("campaign_id");
        init => Set("campaign_id", value);
    }

    /// <summary><c>end_goal_key</c>.</summary>
    public string? EndGoalKey
    {
        get => Get<string?>("end_goal_key");
        init => Set("end_goal_key", value);
    }

    /// <summary><c>app_ids</c>.</summary>
    public IReadOnlyList<string>? AppIds
    {
        get => Get<IReadOnlyList<string>?>("app_ids");
        init => Set("app_ids", value);
    }

    /// <summary><c>deep_link_path</c>.</summary>
    public string? DeepLinkPath
    {
        get => Get<string?>("deep_link_path");
        init => Set("deep_link_path", value);
    }

    /// <summary>Your own data the app receives with the deep link.</summary>
    public IReadOnlyDictionary<string, object?>? DeepLinkData
    {
        get => Get<IReadOnlyDictionary<string, object?>?>("deep_link_data");
        init => Set("deep_link_data", value);
    }

    /// <summary><c>app_or_store</c>, <c>app_or_web</c> or <c>web_only</c>.</summary>
    public string? AppBehavior
    {
        get => Get<string?>("app_behavior");
        init => Set("app_behavior", value);
    }

    /// <summary><c>auto</c>, <c>always</c> or <c>never</c>.</summary>
    public string? IosInterstitial
    {
        get => Get<string?>("ios_interstitial");
        init => Set("ios_interstitial", value);
    }

    /// <summary><c>whatsapp_message</c>.</summary>
    public string? WhatsappMessage
    {
        get => Get<string?>("whatsapp_message");
        init => Set("whatsapp_message", value);
    }

    /// <summary><c>offline_code</c>.</summary>
    public string? OfflineCode
    {
        get => Get<string?>("offline_code");
        init => Set("offline_code", value);
    }

    /// <summary><c>auto</c> or <c>off</c>.</summary>
    public string? OpenInApp
    {
        get => Get<string?>("open_in_app");
        init => Set("open_in_app", value);
    }

    /// <summary><c>inherit</c>, <c>on</c> or <c>off</c>.</summary>
    public string? InAppBrowserPage
    {
        get => Get<string?>("in_app_browser_page");
        init => Set("in_app_browser_page", value);
    }

    /// <summary><c>whatsapp</c>, <c>instagram</c>, <c>facebook</c>, <c>tiktok</c>, <c>x</c>, <c>linkedin</c>, <c>sms</c>, <c>telegram</c>, <c>email</c>, <c>youtube</c> or <c>qr</c>.</summary>
    public string? MadeFor
    {
        get => Get<string?>("made_for");
        init => Set("made_for", value);
    }

    /// <summary>Fields this SDK version doesn't have a property for yet, with their API names.</summary>
    public IReadOnlyDictionary<string, object?>? Extra
    {
        get => null;
        init
        {
            foreach (var kv in value ?? new Dictionary<string, object?>())
            {
                Set(kv.Key, kv.Value);
            }
        }
    }

    /// <summary>The request body, with the API's field names.</summary>
    public JsonObject ToJson() => Json.ToNode(_fields) as JsonObject ?? [];

    private T? Get<T>(string key) => _fields.TryGetValue(key, out var v) && v is T t ? t : default;

    private void Set(string key, object? value) => _fields[key] = value;

    /// <inheritdoc/>
    public bool Equals(LinkUpdateParams? other) => other is not null && JsonNode.DeepEquals(ToJson(), other.ToJson());

    /// <inheritdoc/>
    public override int GetHashCode() => StringComparer.Ordinal.GetHashCode(ToJson().ToJsonString());

    /// <inheritdoc/>
    public override string ToString() => ToJson().ToJsonString();
}
