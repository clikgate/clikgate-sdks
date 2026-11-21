package com.clikgate.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A background job ({@code /v1/jobs}), e.g. a referrer import. */
public final class Job extends WireObject {
  public Job(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The job ID ({@code job_...}); follow it with {@code GET /v1/jobs/{id}}. */
  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getType() {
    return string("type");
  }

  /** {@code queued}, {@code running}, {@code succeeded}, {@code failed}, ... */
  public @Nullable String getStatus() {
    return string("status");
  }

  public long getTotal() {
    return longOrZero("total");
  }

  public long getSucceeded() {
    return longOrZero("succeeded");
  }

  public long getFailed() {
    return longOrZero("failed");
  }

  /** One entry per input item (referrer imports, bulk link jobs), or the file of an export. */
  public List<Result> getResults() {
    return objects("results", Result::new);
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getFinishedAt() {
    return instant("finished_at");
  }

  /** One result of a job. Only the keys that apply are set. */
  public static final class Result extends WireObject {
    public Result(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    /** The input item's position (0 is the first), or null. */
    public @Nullable Integer getIndex() {
      return intNumber("index");
    }

    /** Whether the input item succeeded, or null. */
    public @Nullable Boolean getOk() {
      return bool("ok");
    }

    /** Referrer imports: the referrer. */
    public @Nullable String getReferrerId() {
      return string("referrer_id");
    }

    /** Referrer imports: true when the referrer is new, false when updated. */
    public @Nullable Boolean getCreated() {
      return bool("created");
    }

    /** Bulk link jobs: the link created or changed. */
    public @Nullable String getLinkId() {
      return string("link_id");
    }

    /** Exports and downloads: a signed link to the file. */
    public @Nullable String getUrl() {
      return string("url");
    }

    /** When {@link #getUrl()} stops working (Unix seconds). */
    public @Nullable Long getExpiresAt() {
      return longNumber("expires_at");
    }

    /** Exports: the rows in the file. */
    public @Nullable Long getRows() {
      return longNumber("rows");
    }

    /** QR placement downloads: the images in the ZIP. */
    public @Nullable Long getFiles() {
      return longNumber("files");
    }

    /** Report exports: the report run exported. */
    public @Nullable String getRunId() {
      return string("run_id");
    }

    /** Test data resets: the kind of data deleted. */
    public @Nullable String getTable() {
      return string("table");
    }

    /** Test data resets: how many rows were deleted. */
    public @Nullable Long getDeleted() {
      return longNumber("deleted");
    }

    /** Why the item or job failed, or null. */
    public @Nullable ResultError getError() {
      return object("error", ResultError::new);
    }
  }

  /** Why a job item failed. */
  public static final class ResultError extends WireObject {
    public ResultError(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    /** {@code invalid_request} or {@code server}. */
    public @Nullable String getType() {
      return string("type");
    }

    public @Nullable String getCode() {
      return string("code");
    }

    public @Nullable String getMessage() {
      return string("message");
    }

    /** The field of the item that was refused, or null. */
    public @Nullable String getParam() {
      return string("param");
    }

    /** QR placement downloads: the placement left out, or null. */
    public @Nullable Long getNumber() {
      return longNumber("number");
    }

    /** QR placement downloads: why it was left out; empty otherwise. */
    public List<String> getReasons() {
      return strings("reasons");
    }
  }
}
