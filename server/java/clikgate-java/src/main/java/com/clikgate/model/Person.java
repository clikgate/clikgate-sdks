package com.clikgate.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A person: everything Clikgate knows belongs to one customer ({@code /v1/people}). Every field is in {@link #toMap()}. */
public final class Person extends WireObject {
  public Person(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The person ID ({@code per_...}). */
  public @Nullable String getId() {
    return string("id");
  }

  /** What your team sees instead of the click ID, or null. */
  public @Nullable String getLabel() {
    return string("label");
  }

  /** Who set the label: {@code api}, {@code dashboard}, {@code app}, ... */
  public @Nullable String getLabelSource() {
    return string("label_source");
  }

  public @Nullable Instant getLabelUpdatedAt() {
    return instant("label_updated_at");
  }

  /** Your user ID for this person (wire {@code customer_user_id}), or null. */
  public @Nullable String getCustomerId() {
    return string("customer_user_id");
  }

  /** The first click ID seen for this person, or null. */
  public @Nullable String getClickId() {
    return string("click_id");
  }

  /** The person this one was merged into, or null. */
  public @Nullable String getMergedInto() {
    return string("merged_into");
  }

  public boolean isCanUnmerge() {
    return Boolean.TRUE.equals(bool("can_unmerge"));
  }

  /** The person's clicks, installs and identifiers ({@code links}), as the API sent them. */
  public List<Map<String, @Nullable Object>> getLinks() {
    return objects("links", Person::copy);
  }

  /** Earlier labels ({@code label_history}), as the API sent them. */
  public List<Map<String, @Nullable Object>> getLabelHistory() {
    return objects("label_history", Person::copy);
  }

  /** What the person did, newest first ({@code timeline}), as the API sent it. */
  public List<Map<String, @Nullable Object>> getTimeline() {
    return objects("timeline", Person::copy);
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getLastSeenAt() {
    return instant("last_seen_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  private static Map<String, @Nullable Object> copy(Map<String, ?> m) {
    return java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<String, @Nullable Object>(m));
  }
}
