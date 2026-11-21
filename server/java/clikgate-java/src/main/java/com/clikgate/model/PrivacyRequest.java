package com.clikgate.model;

import java.time.Instant;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A privacy request (access, export, delete or erasure) for one data subject ({@code /v1/privacy/requests}). */
public final class PrivacyRequest extends WireObject {
  public PrivacyRequest(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getAppId() {
    return string("app_id");
  }

  /** {@code access}, {@code export}, {@code delete} or {@code erasure}. */
  public @Nullable String getType() {
    return string("type");
  }

  /** {@code installation}, {@code customer_user}, {@code email}, {@code phone}, {@code person} or {@code click}. */
  public @Nullable String getSubjectType() {
    return string("subject_type");
  }

  /** {@code pending}, {@code processing}, {@code completed} or {@code failed}. */
  public @Nullable String getStatus() {
    return string("status");
  }

  /** The result as the API sent it (an export's link, or an erasure's counts); null until the request completes. */
  public @Nullable Map<String, @Nullable Object> getResult() {
    return map("result");
  }

  /** A completed export: the signed link to the subject's data; null otherwise. */
  public @Nullable ExportResult getExportResult() {
    Map<String, @Nullable Object> r = map("result");
    return r != null && r.get("download_url") instanceof String ? new ExportResult(r) : null;
  }

  /** A completed erasure: how many records of each kind were erased or anonymised; empty otherwise. */
  public Map<String, Long> getErasedCounts() {
    Map<String, Long> out = new java.util.LinkedHashMap<>();
    Map<String, @Nullable Object> r = map("result");
    if (r != null && !(r.get("download_url") instanceof String)) {
      for (Map.Entry<String, @Nullable Object> e : r.entrySet()) {
        if (e.getValue() instanceof Number) {
          out.put(e.getKey(), Long.valueOf(((Number) e.getValue()).longValue()));
        }
      }
    }
    return java.util.Collections.unmodifiableMap(out);
  }

  public @Nullable String getError() {
    return string("error");
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getCompletedAt() {
    return instant("completed_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** The result of a completed export request. */
  public static final class ExportResult extends WireObject {
    public ExportResult(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    /** A signed link to the JSON file with the subject's data. */
    public @Nullable String getDownloadUrl() {
      return string("download_url");
    }

    /** When the link stops working (Unix seconds). */
    public @Nullable Long getExpiresAt() {
      return longNumber("expires_at");
    }
  }
}
