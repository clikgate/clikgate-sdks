package com.clikgate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The parameters of {@link Links#create(LinkCreateParams)} ({@code CreateLink}). Fields left unset (or null) are
 * not sent, so the API's defaults apply.
 *
 * <pre>{@code
 * Link link = clikgate.links().create(LinkCreateParams.builder().destinationUrl("https://example.com/spring").ogTitle("Spring sale").build());
 * }</pre>
 */
public final class LinkCreateParams {
  private final Map<String, @Nullable Object> body;

  private LinkCreateParams(Map<String, @Nullable Object> body) {
    this.body = body;
  }

  public static Builder builder() {
    return new Builder();
  }

  /** The request body, with the API's field names. */
  public Map<String, @Nullable Object> toMap() {
    return new LinkedHashMap<>(body);
  }

  /** Builder for {@link LinkCreateParams}. */
  public static final class Builder {
    private final Map<String, @Nullable Object> body = new LinkedHashMap<>();

    Builder() {}

    private Builder put(String key, @Nullable Object value) {
      if (value == null) {
        body.remove(key);
      } else {
        body.put(key, value);
      }
      return this;
    }

    /** The domain, e.g. {@code ciz.to}; default the organisation's default domain. */
    public Builder domain(@Nullable String domain) {
      return put("domain", domain);
    }

    /** The path after the domain; default a random one. */
    public Builder slug(@Nullable String slug) {
      return put("slug", slug);
    }

    /** Where the link goes (a full URL, or {@code clikgate-test:<page>} with a test key). */
    public Builder destinationUrl(@Nullable String destinationUrl) {
      return put("destination_url", destinationUrl);
    }

    /** Where people go when the destination is not available. */
    public Builder fallbackUrl(@Nullable String fallbackUrl) {
      return put("fallback_url", fallbackUrl);
    }

    public Builder title(@Nullable String title) {
      return put("title", title);
    }

    public Builder ogTitle(@Nullable String ogTitle) {
      return put("og_title", ogTitle);
    }

    public Builder ogDescription(@Nullable String ogDescription) {
      return put("og_description", ogDescription);
    }

    public Builder ogImageUrl(@Nullable String ogImageUrl) {
      return put("og_image_url", ogImageUrl);
    }

    public Builder clickIdParam(@Nullable String clickIdParam) {
      return put("click_id_param", clickIdParam);
    }

    public Builder utmTemplate(@Nullable String utmTemplate) {
      return put("utm_template", utmTemplate);
    }

    public Builder attributionWindowDays(@Nullable Integer attributionWindowDays) {
      return put("attribution_window_days", attributionWindowDays);
    }

    /** Your own ID for this link. */
    public Builder externalReference(@Nullable String externalReference) {
      return put("external_reference", externalReference);
    }

    public Builder campaignId(@Nullable String campaignId) {
      return put("campaign_id", campaignId);
    }

    public Builder campaignExternalReference(@Nullable String campaignExternalReference) {
      return put("campaign_external_reference", campaignExternalReference);
    }

    public Builder endGoalKey(@Nullable String endGoalKey) {
      return put("end_goal_key", endGoalKey);
    }

    /** Tags. */
    public Builder tags(@Nullable List<String> tags) {
      return put("tags", tags == null ? null : new ArrayList<String>(tags));
    }

    /** Your own keys on this link (e.g. {@code seller_id}): group and filter results by them. */
    public Builder metadata(@Nullable Map<String, ?> metadata) {
      return put("metadata", metadata == null ? null : new LinkedHashMap<String, Object>(metadata));
    }

    /** When the link stops working (RFC 3339). */
    public Builder expiresAt(@Nullable String expiresAt) {
      return put("expires_at", expiresAt);
    }

    /** When the link stops working. */
    public Builder expiresAt(@Nullable Instant expiresAt) {
      return put("expires_at", expiresAt == null ? null : com.clikgate.internal.Dates.format(expiresAt));
    }

    /** Routing rules ({@code priority}, {@code conditions}, {@code destination_type}, ...), as the API names them. */
    public Builder rules(@Nullable List<? extends Map<String, ?>> rules) {
      return put("rules", rules == null ? null : new ArrayList<Object>(rules));
    }

    public Builder appIds(@Nullable List<String> appIds) {
      return put("app_ids", appIds == null ? null : new ArrayList<String>(appIds));
    }

    public Builder deepLinkPath(@Nullable String deepLinkPath) {
      return put("deep_link_path", deepLinkPath);
    }

    /** Your own data the app receives with the deep link. */
    public Builder deepLinkData(@Nullable Map<String, ?> deepLinkData) {
      return put("deep_link_data", deepLinkData == null ? null : new LinkedHashMap<String, Object>(deepLinkData));
    }

    /** {@code app_or_store}, {@code app_or_web} or {@code web_only}. */
    public Builder appBehavior(@Nullable String appBehavior) {
      return put("app_behavior", appBehavior);
    }

    /** {@code auto}, {@code always} or {@code never}. */
    public Builder iosInterstitial(@Nullable String iosInterstitial) {
      return put("ios_interstitial", iosInterstitial);
    }

    /** {@code standard} or {@code whatsapp}. */
    public Builder kind(@Nullable String kind) {
      return put("kind", kind);
    }

    public Builder whatsappChannelId(@Nullable String whatsappChannelId) {
      return put("whatsapp_channel_id", whatsappChannelId);
    }

    public Builder whatsappMessage(@Nullable String whatsappMessage) {
      return put("whatsapp_message", whatsappMessage);
    }

    public Builder offlineCode(@Nullable String offlineCode) {
      return put("offline_code", offlineCode);
    }

    /** {@code auto} or {@code off}. */
    public Builder openInApp(@Nullable String openInApp) {
      return put("open_in_app", openInApp);
    }

    /** {@code inherit}, {@code on} or {@code off}. */
    public Builder inAppBrowserPage(@Nullable String inAppBrowserPage) {
      return put("in_app_browser_page", inAppBrowserPage);
    }

    /** {@code whatsapp}, {@code instagram}, {@code facebook}, {@code tiktok}, {@code x}, {@code linkedin}, {@code sms}, {@code telegram}, {@code email}, {@code youtube} or {@code qr}. */
    public Builder madeFor(@Nullable String madeFor) {
      return put("made_for", madeFor);
    }

    /** A field this SDK version doesn't have a method for yet, with its API name. */
    public Builder extra(String field, @Nullable Object value) {
      return put(field, value);
    }

    public LinkCreateParams build() {
      return new LinkCreateParams(new LinkedHashMap<>(body));
    }
  }
}
