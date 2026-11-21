package com.clikgate.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A link ({@code /v1/links}). Every field is in {@link #toMap()}. */
public final class Link extends WireObject {
  public Link(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getShortUrl() {
    return string("short_url");
  }

  public @Nullable String getDestinationUrl() {
    return string("destination_url");
  }

  public @Nullable String getStatus() {
    return string("status");
  }

  /** Your own ID for this link ({@code external_reference}), else null. */
  public @Nullable String getExternalReference() {
    return string("external_reference");
  }

  /**
   * Your own keys on this link ({@code metadata}, e.g. {@code seller_id}); empty when it has none. Results can be
   * grouped ({@code group_by=metadata.<key>}) and filtered ({@code metadata[<key>]}) by them.
   */
  public Map<String, @Nullable Object> getMetadata() {
    Map<String, @Nullable Object> m = map("metadata");
    return m == null ? java.util.Collections.<String, @Nullable Object>emptyMap() : java.util.Collections.unmodifiableMap(m);
  }

  /** {@code "premium"} on {@code ciz.to} links, else null. */
  public @Nullable String getDomainBadge() {
    return string("domain_badge");
  }

  /** True when destination, fallback and deep-link changes are refused ({@code 409 link_locked}). */
  public boolean isLocked() {
    return Boolean.TRUE.equals(bool("locked"));
  }

  /** Non-blocking warnings ({@code code}, {@code message}, {@code param}), e.g. {@code no_preview}. */
  public List<Map<String, @Nullable Object>> getWarnings() {
    List<Map<String, @Nullable Object>> out = new ArrayList<>();
    for (Object o : list("warnings")) {
      @SuppressWarnings("unchecked")
      Map<String, @Nullable Object> m = o instanceof Map ? (Map<String, @Nullable Object>) o : null;
      if (m != null) {
        out.add(m);
      }
    }
    return out;
  }

  /** The domain, e.g. {@code ciz.to}. */
  public @Nullable String getDomain() {
    return string("domain");
  }

  public @Nullable String getDomainGroupId() {
    return string("domain_group_id");
  }

  /** The path after the domain. */
  public @Nullable String getSlug() {
    return string("slug");
  }

  /** Where people go when the destination is not available, else null. */
  public @Nullable String getFallbackUrl() {
    return string("fallback_url");
  }

  /** The click-ID query parameter added to the destination. */
  public @Nullable String getClickIdParam() {
    return string("click_id_param");
  }

  public @Nullable String getUtmTemplate() {
    return string("utm_template");
  }

  public @Nullable String getCampaignId() {
    return string("campaign_id");
  }

  /** The goal this link is meant to lead to, else null. */
  public @Nullable String getEndGoalKey() {
    return string("end_goal_key");
  }

  public @Nullable String getTitle() {
    return string("title");
  }

  /** The preview title. */
  public @Nullable String getOgTitle() {
    return string("og_title");
  }

  /** The preview description. */
  public @Nullable String getOgDescription() {
    return string("og_description");
  }

  /** The preview image. */
  public @Nullable String getOgImageUrl() {
    return string("og_image_url");
  }

  public @Nullable String getPausedReason() {
    return string("paused_reason");
  }

  /** {@code standard} or {@code whatsapp}. */
  public @Nullable String getKind() {
    return string("kind");
  }

  /** The in-app path the app opens, else null. */
  public @Nullable String getDeepLinkPath() {
    return string("deep_link_path");
  }

  /** {@code app_or_store}, {@code app_or_web} or {@code web_only}. */
  public @Nullable String getAppBehavior() {
    return string("app_behavior");
  }

  /** {@code auto}, {@code always} or {@code never}. */
  public @Nullable String getIosInterstitial() {
    return string("ios_interstitial");
  }

  /** Set on a referrer's link. */
  public @Nullable String getReferralProgramId() {
    return string("referral_program_id");
  }

  /** Set on a referrer's link. */
  public @Nullable String getReferrerId() {
    return string("referrer_id");
  }

  public @Nullable String getWhatsappChannelId() {
    return string("whatsapp_channel_id");
  }

  public @Nullable String getWhatsappMessage() {
    return string("whatsapp_message");
  }

  /** The code people can type instead of clicking, else null. */
  public @Nullable String getOfflineCode() {
    return string("offline_code");
  }

  /** Who locked the link, else null. */
  public @Nullable String getLockedBy() {
    return string("locked_by");
  }

  /** {@code auto} or {@code off}. */
  public @Nullable String getOpenInApp() {
    return string("open_in_app");
  }

  /** {@code inherit}, {@code on} or {@code off}. */
  public @Nullable String getInAppBrowserPage() {
    return string("in_app_browser_page");
  }

  /** Where the link is meant to be shared ({@code whatsapp}, {@code instagram}, ...), else null. */
  public @Nullable String getMadeFor() {
    return string("made_for");
  }

  /** A suggested improvement (e.g. {@code make_whatsapp_link}), else null. */
  public @Nullable String getSuggestion() {
    return string("suggestion");
  }

  /** The link on each active domain of its group. */
  public List<Url> getUrls() {
    return objects("urls", Url::new);
  }

  /** Days a click can be credited for a goal. */
  public @Nullable Integer getAttributionWindowDays() {
    return intNumber("attribution_window_days");
  }

  public List<String> getTags() {
    return strings("tags");
  }

  public @Nullable Instant getExpiresAt() {
    return instant("expires_at");
  }

  /** The apps this link opens. */
  public List<String> getAppIds() {
    return strings("app_ids");
  }

  /** Your own data the app receives with the deep link ({@code deep_link_data}); empty when none. */
  public Map<String, @Nullable Object> getDeepLinkData() {
    return mapOrEmpty("deep_link_data");
  }

  /** True on a free domain link kept on a paid domain. */
  public boolean isLegacyFreeOnPaidDomain() {
    return Boolean.TRUE.equals(bool("legacy_free_on_paid_domain"));
  }

  /** True while the link waits for a review (it doesn't redirect). */
  public boolean isUnderReview() {
    return Boolean.TRUE.equals(bool("under_review"));
  }

  public @Nullable Instant getLockedAt() {
    return instant("locked_at");
  }

  /** The app page this link opens in place of a web page, else null. */
  public @Nullable OpenInAppTarget getOpenInAppTarget() {
    return object("open_in_app_target", OpenInAppTarget::new);
  }

  /** One URL per sharing channel ({@code whatsapp}, {@code instagram}, ...); empty when none. */
  public Map<String, String> getShareUrls() {
    Map<String, String> out = new java.util.LinkedHashMap<>();
    for (Map.Entry<String, @Nullable Object> e : mapOrEmpty("share_urls").entrySet()) {
      if (e.getValue() instanceof String) {
        out.put(e.getKey(), (String) e.getValue());
      }
    }
    return java.util.Collections.unmodifiableMap(out);
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getUpdatedAt() {
    return instant("updated_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** The link on one domain of its group. */
  public static final class Url extends WireObject {
    public Url(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getDomain() {
      return string("domain");
    }

    public @Nullable String getUrl() {
      return string("url");
    }

    /** {@code primary} or {@code alias}. */
    public @Nullable String getRole() {
      return string("role");
    }
  }

  /** The app page a link opens. */
  public static final class OpenInAppTarget extends WireObject {
    public OpenInAppTarget(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getAppKey() {
      return string("app_key");
    }

    public @Nullable String getAppName() {
      return string("app_name");
    }

    public @Nullable String getPageType() {
      return string("page_type");
    }

    /** {@code active}, {@code paused} or {@code disabled}. */
    public @Nullable String getStatus() {
      return string("status");
    }
  }
}
