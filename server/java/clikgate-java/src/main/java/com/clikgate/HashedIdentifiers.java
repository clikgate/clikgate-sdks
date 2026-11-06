package com.clikgate;

import org.jspecify.annotations.Nullable;

/**
 * Hashed email and phone for ad network matching (SPEC 25), from {@link HashForAds#hash}: SHA-256 values as
 * 64 lowercase hex characters, wired as {@code hashed_email}, {@code hashed_phone_e164} and {@code hashed_phone_digits}.
 * A getter is null when its input wasn't given. Pass it with {@link Goal.Builder#hashed(HashedIdentifiers)}.
 */
public final class HashedIdentifiers {
  private final @Nullable String hashedEmail;
  private final @Nullable String hashedPhoneE164;
  private final @Nullable String hashedPhoneDigits;

  HashedIdentifiers(@Nullable String hashedEmail, @Nullable String hashedPhoneE164, @Nullable String hashedPhoneDigits) {
    this.hashedEmail = hashedEmail;
    this.hashedPhoneE164 = hashedPhoneE164;
    this.hashedPhoneDigits = hashedPhoneDigits;
  }

  /** SHA-256 of the email, trimmed and lowercased, or null. */
  public @Nullable String getHashedEmail() {
    return hashedEmail;
  }

  /** SHA-256 of the phone in E.164 with the {@code +} ({@code +2348031234567}), or null. */
  public @Nullable String getHashedPhoneE164() {
    return hashedPhoneE164;
  }

  /** SHA-256 of the phone digits with the country code, no {@code +} ({@code 2348031234567}), or null. */
  public @Nullable String getHashedPhoneDigits() {
    return hashedPhoneDigits;
  }

  /** Never shows the hashes (they are left out of logs, like values). */
  @Override
  public String toString() {
    return "HashedIdentifiers{hashedEmail=" + (hashedEmail == null ? "null" : "[set]")
        + ", hashedPhoneE164=" + (hashedPhoneE164 == null ? "null" : "[set]")
        + ", hashedPhoneDigits=" + (hashedPhoneDigits == null ? "null" : "[set]") + "}";
  }
}
