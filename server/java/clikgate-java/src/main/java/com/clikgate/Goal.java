package com.clikgate;

import com.clikgate.model.Provider;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The options of one goal event. Only {@code reference} is required.
 *
 * <pre>{@code
 * Goal goal = Goal.builder()
 *     .clickId(application.getClickId())   // kept since the visitor landed
 *     .reference("APP-55231")              // your own unique ID: a resend never counts twice
 *     .value(new BigDecimal("2000000"))    // ₦2,000,000 in normal units
 *     .currency("NGN")
 *     .build();
 * }</pre>
 */
public final class Goal {
  final @Nullable String reference;
  final @Nullable String clickId;
  final @Nullable String code;
  final @Nullable Object value;
  final @Nullable String currency;
  final @Nullable String provider;
  final @Nullable Boolean isFirst;
  final @Nullable String label;
  final @Nullable String keptBy;
  final @Nullable String browserEngine;
  final @Nullable String platform;
  final @Nullable String hashedEmail;
  final @Nullable String hashedPhoneE164;
  final @Nullable String hashedPhoneDigits;
  final @Nullable Object occurredAt;
  final @Nullable Map<String, ?> metadata;
  final @Nullable Map<String, ?> consent;
  final Map<String, ?> extra;

  private Goal(Builder b) {
    reference = b.reference;
    clickId = b.clickId;
    code = b.code;
    value = b.value;
    currency = b.currency;
    provider = b.provider;
    isFirst = b.isFirst;
    label = b.label;
    keptBy = b.keptBy;
    browserEngine = b.browserEngine;
    platform = b.platform;
    hashedEmail = b.hashedEmail;
    hashedPhoneE164 = b.hashedPhoneE164;
    hashedPhoneDigits = b.hashedPhoneDigits;
    occurredAt = b.occurredAt;
    metadata = b.metadata;
    consent = b.consent;
    extra = Collections.unmodifiableMap(new LinkedHashMap<String, Object>(b.extra));
  }

  public static Builder builder() {
    return new Builder();
  }

  /** A goal with just a reference. */
  public static Goal of(String reference) {
    return builder().reference(reference).build();
  }

  /** Builder for {@link Goal}. Every setter accepts null for "unset". */
  public static final class Builder {
    private @Nullable String reference;
    private @Nullable String clickId;
    private @Nullable String code;
    private @Nullable Object value;
    private @Nullable String currency;
    private @Nullable String provider;
    private @Nullable Boolean isFirst;
    private @Nullable String label;
    private @Nullable String keptBy;
    private @Nullable String browserEngine;
    private @Nullable String platform;
    private @Nullable String hashedEmail;
    private @Nullable String hashedPhoneE164;
    private @Nullable String hashedPhoneDigits;
    private @Nullable Object occurredAt;
    private @Nullable Map<String, ?> metadata;
    private @Nullable Map<String, ?> consent;
    private final Map<String, @Nullable Object> extra = new LinkedHashMap<>();

    private Builder() {}

    /** Your own unique ID for this event (application number, order ID, transaction reference), 1-128 characters. */
    public Builder reference(@Nullable String reference) {
      this.reference = reference;
      return this;
    }

    /** The Clikgate click ID you kept ({@code clk_…}). */
    public Builder clickId(@Nullable String clickId) {
      this.clickId = clickId;
      return this;
    }

    /** An offline or creator code, instead of a click ID. */
    public Builder code(@Nullable String code) {
      this.code = code;
      return this;
    }

    /** The value in normal units, e.g. {@code new BigDecimal("1500.50")}; sent as a decimal string with its scale. */
    public Builder value(@Nullable BigDecimal value) {
      this.value = value;
      return this;
    }

    /** An integer value in normal units. */
    public Builder value(long value) {
      this.value = value;
      return this;
    }

    /** A decimal string in normal units, like {@code "1500.50"} (no signs, exponents or separators). */
    public Builder value(@Nullable String value) {
      this.value = value;
      return this;
    }

    /** ISO 4217; defaults to the goal's default currency. */
    public Builder currency(@Nullable String currency) {
      this.currency = currency;
      return this;
    }

    /**
     * The payment provider of a Payment goal, e.g. {@code Provider.PAYSTACK}. Any goal may carry it; the API checks
     * it.
     */
    public Builder provider(@Nullable Provider provider) {
      this.provider = provider == null ? null : provider.getValue();
      return this;
    }

    /**
     * The payment provider as its key, e.g. {@code "paystack"}: also a gateway added after this SDK release
     * (lower-case snake_case; the API validates it).
     */
    public Builder provider(@Nullable String provider) {
      this.provider = provider;
      return this;
    }

    /** Your statement that this is the customer's first such event. */
    public Builder isFirst(@Nullable Boolean isFirst) {
      this.isFirst = isFirst;
      return this;
    }

    /**
     * The person's label your team sees instead of the click ID (1-80 characters, {@code ""} clears it; Growth and
     * up). In private mode only when the organisation allows labels there.
     */
    public Builder label(@Nullable String label) {
      this.label = label;
      return this;
    }

    /**
     * How the click ID was kept: {@code server_cookie}, {@code script_cookie}, {@code form},
     * {@code payment_metadata} or {@code unknown}. Allowed in private mode.
     */
    public Builder keptBy(@Nullable String keptBy) {
      this.keptBy = keptBy;
      return this;
    }

    /** The browser engine: {@code webkit_ios}, {@code safari_mac}, {@code chromium}, {@code gecko} or {@code other}. */
    public Builder browserEngine(@Nullable String browserEngine) {
      this.browserEngine = browserEngine;
      return this;
    }

    /** The platform: {@code ios}, {@code android}, {@code macos}, {@code windows}, {@code linux} or {@code other}. */
    public Builder platform(@Nullable String platform) {
      this.platform = platform;
      return this;
    }

    /**
     * The visitor context from {@link ClickIds#context}: its click ID (when there is one and none is set yet),
     * {@code keptBy}, {@code browserEngine} and {@code platform}.
     */
    public Builder context(@Nullable ClickContext context) {
      if (context == null) {
        return this;
      }
      if (this.clickId == null && this.code == null) {
        this.clickId = context.getClickId();
      }
      this.keptBy = context.getKeptBy();
      this.browserEngine = context.getBrowserEngine();
      this.platform = context.getPlatform();
      return this;
    }

    /**
     * SHA-256 of the customer's email, trimmed and lowercased, as 64 lowercase hex characters, for ad
     * network matching; make it with {@link HashForAds#hash}. Sent only if the business turned on matching by hashed
     * email or phone for a destination. In private mode, hash on your own server: Clikgate never hashes for you there.
     * Any other value is refused locally ({@code invalid_hashed_identifier}).
     */
    public Builder hashedEmail(@Nullable String hashedEmail) {
      this.hashedEmail = hashedEmail;
      return this;
    }

    /** SHA-256 of the phone in E.164 with the {@code +} ({@link HashForAds#hash}). See {@link #hashedEmail}. */
    public Builder hashedPhoneE164(@Nullable String hashedPhoneE164) {
      this.hashedPhoneE164 = hashedPhoneE164;
      return this;
    }

    /** SHA-256 of the phone digits with the country code, no {@code +} ({@link HashForAds#hash}). See {@link #hashedEmail}. */
    public Builder hashedPhoneDigits(@Nullable String hashedPhoneDigits) {
      this.hashedPhoneDigits = hashedPhoneDigits;
      return this;
    }

    /**
     * The three hashed identifiers from {@link HashForAds#hash} (the ones it made; the others are unset).
     *
     * <pre>{@code
     * Goal.builder().reference("APP-55231").clickId(clickId)
     *     .hashed(HashForAds.hash(customer.getEmail(), customer.getPhone()))
     *     .build();
     * }</pre>
     */
    public Builder hashed(@Nullable HashedIdentifiers hashed) {
      if (hashed == null) {
        return this;
      }
      this.hashedEmail = hashed.getHashedEmail();
      this.hashedPhoneE164 = hashed.getHashedPhoneE164();
      this.hashedPhoneDigits = hashed.getHashedPhoneDigits();
      return this;
    }

    /** When it happened (defaults to now on the server). */
    public Builder occurredAt(@Nullable Instant occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** When it happened (defaults to now on the server). */
    public Builder occurredAt(@Nullable OffsetDateTime occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** When it happened, as an RFC 3339 string (sent unchanged). */
    public Builder occurredAt(@Nullable String occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    /** Up to 8 KB of your own data. Refused in private mode. */
    public Builder metadata(@Nullable Map<String, ?> metadata) {
      this.metadata = metadata;
      return this;
    }

    /** Consent signals ({@code analytics}, {@code attribution}, {@code ad_user_data}, {@code ad_personalization}). Allowed in private mode. */
    public Builder consent(@Nullable Map<String, ?> consent) {
      this.consent = consent;
      return this;
    }

    /** An additional wire field, sent as is (forward compatibility). Checked by the private-mode guard. */
    public Builder extra(String field, @Nullable Object value) {
      this.extra.put(field, value);
      return this;
    }

    /** Advanced (adapters, tests): a value of any supported type (BigDecimal, Long, Integer, BigInteger or a decimal String). */
    public Builder rawValue(@Nullable Object value) {
      this.value = value;
      return this;
    }

    /** Advanced (adapters, tests): an occurredAt of any supported type (Instant, OffsetDateTime, ZonedDateTime, Date or String). */
    public Builder rawOccurredAt(@Nullable Object occurredAt) {
      this.occurredAt = occurredAt;
      return this;
    }

    public Goal build() {
      return new Goal(this);
    }
  }
}
