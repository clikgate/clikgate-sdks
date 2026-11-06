package com.clikgate.model;

import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The answer of {@code identifyUser(...)} ({@code object: "person_identified"}). */
public final class PersonIdentified extends WireObject {
  public PersonIdentified(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The person ({@code per_...}). */
  public @Nullable String getPersonId() {
    return string("person_id");
  }

  /**
   * {@code plan} (below Growth the label isn't stored), {@code lower_rank} (a label your team set was kept), or null.
   */
  public @Nullable String getLabelIgnored() {
    return string("label_ignored");
  }
}
