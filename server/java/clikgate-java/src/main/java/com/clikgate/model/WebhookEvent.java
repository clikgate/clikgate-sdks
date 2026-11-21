package com.clikgate.model;

import java.time.Instant;
import java.util.Map;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * A webhook event: {@code id}, {@code type} (an {@link EventType} constant), {@code data}, ... Read {@code data.object}
 * typed with {@link #asReferral()}, {@link #asReferrer()}, {@link #asGoalEvent()}, {@link #asInstall()},
 * {@link #asPayment()}, {@link #asConversion()} or {@link #asDeviceChange()}. Each one returns null when the event's
 * type belongs to another family (or {@code data.object} isn't an object), never a wrong object.
 *
 * <pre>{@code
 * WebhookEvent event = Webhooks.verify(body, signature, secret);
 * Referral referral = event.asReferral();   // null unless this is a referral.* event
 * if (EventType.REFERRAL_QUALIFIED.equals(event.getType()) && referral != null) { ... }
 * }</pre>
 */
public final class WebhookEvent extends WireObject {
  public WebhookEvent(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The event ID ({@code evt_...}); dedupe on it, delivery is at-least-once. */
  public @Nullable String getId() {
    return string("id");
  }

  /** The event type, e.g. {@link EventType#REFERRAL_QUALIFIED}. */
  public @Nullable String getType() {
    return string("type");
  }

  /** The API version the payload is shaped for. */
  public @Nullable String getApiVersion() {
    return string("api_version");
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable String getOrganizationId() {
    return string("organization_id");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** {@code object} and the event's extra keys (e.g. {@code from}, {@code to}, {@code actor} on {@code link.destination_changed}; {@code change}, {@code add_on_key} on {@code subscription.updated}). */
  public @Nullable Map<String, @Nullable Object> getData() {
    return map("data");
  }

  /**
   * The referral of a {@code referral.*} event. Null for any other event type.
   */
  public @Nullable Referral asReferral() {
    return typed("referral.", Referral::new);
  }

  /**
   * The referrer of a {@code referrer.*} event. Null for any other event type.
   */
  public @Nullable Referrer asReferrer() {
    return typed("referrer.", Referrer::new);
  }

  /**
   * The goal event of {@code goal.completed} or {@code goal.reversed} ({@code data.reversal} has the reversal). Null for any other event type.
   */
  public @Nullable GoalEvent asGoalEvent() {
    return typed("goal.", GoalEvent::new);
  }

  /**
   * The install of an {@code install.*} event. Null for any other event type.
   */
  public @Nullable Install asInstall() {
    return typed("install.", Install::new);
  }

  /**
   * The payment report of a {@code payment.*} event. Null for any other event type.
   */
  public @Nullable PaymentReport asPayment() {
    return typed("payment.", PaymentReport::new);
  }

  /**
   * The conversion of a {@code conversion.*} event. Null for any other event type.
   */
  public @Nullable Conversion asConversion() {
    return typed("conversion.", Conversion::new);
  }

  /**
   * The device change of a {@code person.device_changed} event. Null for any other event type.
   */
  public @Nullable DeviceChange asDeviceChange() {
    if (!EventType.PERSON_DEVICE_CHANGED.equals(getType())) {
      return null;
    }
    return typed("person.device_changed", DeviceChange::new);
  }

  private <T> @Nullable T typed(String prefix, Function<Map<String, ?>, T> make) {
    String type = getType();
    if (type == null || !type.startsWith(prefix)) {
      return null;
    }
    Map<String, @Nullable Object> data = getData();
    Map<String, ?> object = data == null ? null : asMap(data.get("object"));
    if (object == null) {
      return null;
    }
    return make.apply(object);
  }
}
