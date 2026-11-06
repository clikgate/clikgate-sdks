package com.clikgate;

import org.jspecify.annotations.Nullable;

/**
 * The parameters of {@link Clikgate#identifyUser(IdentifyUserParams)}: at least one of {@code clickId},
 * {@code appId} + {@code installationId}, {@code customerId}.
 *
 * <pre>{@code
 * clikgate.identifyUser(IdentifyUserParams.builder().clickId(order.clickId()).customerId("user_42").label("Ada (VIP)").build());
 * }</pre>
 */
public final class IdentifyUserParams {
  final @Nullable String clickId;
  final @Nullable String appId;
  final @Nullable String installationId;
  final @Nullable String customerId;
  final @Nullable String label;

  private IdentifyUserParams(Builder b) {
    clickId = b.clickId;
    appId = b.appId;
    installationId = b.installationId;
    customerId = b.customerId;
    label = b.label;
  }

  public static Builder builder() {
    return new Builder();
  }

  /** Builder for {@link IdentifyUserParams}. */
  public static final class Builder {
    private @Nullable String clickId;
    private @Nullable String appId;
    private @Nullable String installationId;
    private @Nullable String customerId;
    private @Nullable String label;

    Builder() {}

    /** The Clikgate click ID you kept ({@code clk_...}). */
    public Builder clickId(@Nullable String clickId) {
      this.clickId = clickId;
      return this;
    }

    /** An app installation: the app's ID, with {@link #installationId(String)}. */
    public Builder appId(@Nullable String appId) {
      this.appId = appId;
      return this;
    }

    /** The SDK's installation ID, with {@link #appId(String)}. */
    public Builder installationId(@Nullable String installationId) {
      this.installationId = installationId;
      return this;
    }

    /** Your customer ID. With a click or installation, links it to this customer. Refused in private mode. */
    public Builder customerId(@Nullable String customerId) {
      this.customerId = customerId;
      return this;
    }

    /** A label your team sees instead of the click ID (1-80 characters, {@code ""} clears it; Growth and up). */
    public Builder label(@Nullable String label) {
      this.label = label;
      return this;
    }

    public IdentifyUserParams build() {
      return new IdentifyUserParams(this);
    }
  }
}
