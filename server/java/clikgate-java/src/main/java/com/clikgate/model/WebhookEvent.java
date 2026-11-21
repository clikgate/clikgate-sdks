package com.clikgate.model;

import java.time.Instant;
import java.util.Map;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * A webhook event: {@code id}, {@code type} (an {@link EventType} constant), {@code data}, ... Read {@code data.object}
 * typed with {@link #asReferral()}, {@link #asReferrer()}, {@link #asGoalEvent()}, {@link #asInstall()},
 * {@link #asPayment()} or {@link #asConversion()}. Each one throws {@link IllegalStateException} when the event's
 * type belongs to another family (or {@code data.object} isn't an object), so check {@link #getType()} first.
 *
 * <pre>{@code
 * WebhookEvent event = Webhooks.verify(body, signature, secret);
 * if (EventType.REFERRAL_QUALIFIED.equals(event.getType())) {
 *   Referral referral = event.asReferral();
 * }
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
   * The referral of a {@code referral.*} event.
   *
   * @throws IllegalStateException when this isn't a {@code referral.*} event
   */
  public Referral asReferral() {
    return typed("referral.", "asReferral", Referral::new);
  }

  /**
   * The referrer of a {@code referrer.*} event.
   *
   * @throws IllegalStateException when this isn't a {@code referrer.*} event
   */
  public Referrer asReferrer() {
    return typed("referrer.", "asReferrer", Referrer::new);
  }

  /**
   * The goal event of {@code goal.completed} or {@code goal.reversed} ({@code data.reversal} has the reversal).
   *
   * @throws IllegalStateException when this isn't a {@code goal.*} event
   */
  public GoalEvent asGoalEvent() {
    return typed("goal.", "asGoalEvent", GoalEvent::new);
  }

  /**
   * The install of an {@code install.*} event.
   *
   * @throws IllegalStateException when this isn't an {@code install.*} event
   */
  public Install asInstall() {
    return typed("install.", "asInstall", Install::new);
  }

  /**
   * The payment report of a {@code payment.*} event.
   *
   * @throws IllegalStateException when this isn't a {@code payment.*} event
   */
  public PaymentReport asPayment() {
    return typed("payment.", "asPayment", PaymentReport::new);
  }

  /**
   * The conversion of a {@code conversion.*} event.
   *
   * @throws IllegalStateException when this isn't a {@code conversion.*} event
   */
  public Conversion asConversion() {
    return typed("conversion.", "asConversion", Conversion::new);
  }

  private <T> T typed(String prefix, String method, Function<Map<String, ?>, T> make) {
    String type = getType();
    if (type == null || !type.startsWith(prefix)) {
      throw new IllegalStateException(method + "() needs a " + prefix + "* event, not " + type);
    }
    Map<String, @Nullable Object> data = getData();
    Map<String, ?> object = data == null ? null : asMap(data.get("object"));
    if (object == null) {
      throw new IllegalStateException(method + "(): data.object of this " + type + " event isn't an object");
    }
    return make.apply(object);
  }
}
