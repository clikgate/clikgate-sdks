package com.clikgate.model;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** The result of {@code links().update}: applied now, or waiting for a second person's approval. */
public final class LinkUpdateResult {
  private final boolean applied;
  private final @Nullable Link link;
  private final @Nullable LinkChangeRequest changeRequest;

  public LinkUpdateResult(boolean applied, @Nullable Link link, @Nullable LinkChangeRequest changeRequest) {
    this.applied = applied;
    this.link = link;
    this.changeRequest = changeRequest;
  }

  /** True when the change was applied ({@code 200}); false when it waits for approval ({@code 202}). */
  public boolean isApplied() {
    return applied;
  }

  public @Nullable Link getLink() {
    return link;
  }

  public @Nullable LinkChangeRequest getChangeRequest() {
    return changeRequest;
  }

  /** The link's warnings (empty for a change request). */
  public List<Map<String, @Nullable Object>> getWarnings() {
    return link == null ? Collections.<Map<String, @Nullable Object>>emptyList() : link.getWarnings();
  }

  /** {@code {applied, link, change_request, warnings}}, as the other SDKs return it. */
  public Map<String, @Nullable Object> toMap() {
    Map<String, @Nullable Object> m = new LinkedHashMap<>();
    m.put("applied", applied);
    m.put("link", link == null ? null : link.toMap());
    m.put("change_request", changeRequest == null ? null : changeRequest.toMap());
    m.put("warnings", getWarnings());
    return m;
  }
}
