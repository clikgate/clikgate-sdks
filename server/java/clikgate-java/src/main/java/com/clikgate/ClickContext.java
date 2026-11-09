package com.clikgate;

import org.jspecify.annotations.Nullable;

/**
 * The visitor context for a goal (SPEC 13.1), from {@link ClickIds#context}: the click ID, how it was kept
 * and the browser engine and platform. The SDK parses the {@code User-Agent}; the User-Agent itself is never sent.
 * Pass it with {@link Goal.Builder#context(ClickContext)}. All three fields are allowed in private mode.
 */
public final class ClickContext {
  private final @Nullable String clickId;
  private final @Nullable String keptBy;
  private final String browserEngine;
  private final String platform;

  ClickContext(@Nullable String clickId, @Nullable String keptBy, String browserEngine, String platform) {
    this.clickId = clickId;
    this.keptBy = keptBy;
    this.browserEngine = browserEngine;
    this.platform = platform;
  }

  /** The click ID (query, then cookie, then the {@code Clikgate-Click-Id} header), or null. */
  public @Nullable String getClickId() {
    return clickId;
  }

  /**
   * {@code server_cookie} (the cookie with the {@code _cg_kept=s} marker), {@code script_cookie} (the cookie without
   * it), {@code form} (the {@code Clikgate-Click-Id} header), or null (e.g. straight from the URL, or no click ID).
   */
  public @Nullable String getKeptBy() {
    return keptBy;
  }

  /** {@code webkit_ios}, {@code safari_mac}, {@code chromium}, {@code gecko} or {@code other}. */
  public String getBrowserEngine() {
    return browserEngine;
  }

  /** {@code ios}, {@code android}, {@code macos}, {@code windows}, {@code linux} or {@code other}. */
  public String getPlatform() {
    return platform;
  }
}
