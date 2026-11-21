package com.clikgate.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** An app install ({@code /v1/installs}, {@code install.*} webhooks). Every field is in {@link #toMap()}. */
public final class Install extends WireObject {
  public Install(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The install ID ({@code ins_...}). */
  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getAppId() {
    return string("app_id");
  }

  /** The mobile SDK's installation ID. */
  public @Nullable String getInstallationId() {
    return string("installation_id");
  }

  /** {@code ios} or {@code android}. */
  public @Nullable String getPlatform() {
    return string("platform");
  }

  public @Nullable Instant getFirstOpenAt() {
    return instant("first_open_at");
  }

  public @Nullable String getAppVersion() {
    return string("app_version");
  }

  public @Nullable String getSdkVersion() {
    return string("sdk_version");
  }

  public @Nullable String getOsVersion() {
    return string("os_version");
  }

  public @Nullable String getDeviceModel() {
    return string("device_model");
  }

  public @Nullable String getCountry() {
    return string("country");
  }

  public boolean isReinstall() {
    return Boolean.TRUE.equals(bool("is_reinstall"));
  }

  public @Nullable String getPreviousInstallId() {
    return string("previous_install_id");
  }

  /** {@code attributed}, {@code organic}, {@code pending}, ... */
  public @Nullable String getAttributionStatus() {
    return string("attribution_status");
  }

  /** {@code new}, {@code reinstall}, {@code new_phone}, ... */
  public @Nullable String getInstallKind() {
    return string("install_kind");
  }

  public @Nullable String getMatchType() {
    return string("match_type");
  }

  /** How sure the match is, 0 to 1, or null. */
  public @Nullable Double getConfidence() {
    return doubleNumber("confidence");
  }

  public @Nullable String getClickId() {
    return string("click_id");
  }

  public @Nullable Instant getClickedAt() {
    return instant("clicked_at");
  }

  public @Nullable Instant getAttributedAt() {
    return instant("attributed_at");
  }

  /** The link the install is attributed to, or null. */
  public @Nullable LinkRef getLink() {
    return object("link", LinkRef::new);
  }

  public @Nullable String getCampaignId() {
    return string("campaign_id");
  }

  public List<String> getFraudFlags() {
    return strings("fraud_flags");
  }

  /** Your user ID for this install's customer (wire {@code customer_user_id}), or null. */
  public @Nullable String getCustomerId() {
    return string("customer_user_id");
  }

  /** True when the customer ID came from your server or an identity token. */
  public boolean isIdentityVerified() {
    return Boolean.TRUE.equals(bool("identity_verified"));
  }

  public @Nullable Instant getLastSeenAt() {
    return instant("last_seen_at");
  }

  /** {@code installed}, {@code uninstalled}, ... */
  public @Nullable String getUninstallStatus() {
    return string("uninstall_status");
  }

  public @Nullable Instant getUninstalledDetectedAt() {
    return instant("uninstalled_detected_at");
  }

  /** The install's person (wire {@code person.id}), or null. */
  public @Nullable String getPersonId() {
    Map<String, @Nullable Object> p = map("person");
    Object id = p == null ? null : p.get("id");
    return id instanceof String ? (String) id : null;
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** The link an install is attributed to. */
  public static final class LinkRef extends WireObject {
    public LinkRef(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getId() {
      return string("id");
    }

    public @Nullable String getKind() {
      return string("kind");
    }

    public @Nullable String getExternalReference() {
      return string("external_reference");
    }

    public @Nullable String getCampaignId() {
      return string("campaign_id");
    }

    /** The link's own keys ({@code metadata}); empty when it has none. */
    public Map<String, @Nullable Object> getMetadata() {
      return mapOrEmpty("metadata");
    }
  }
}
