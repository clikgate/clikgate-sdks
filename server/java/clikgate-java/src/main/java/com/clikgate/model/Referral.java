package com.clikgate.model;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** A referral ({@code /v1/referrals}, {@code referral.*} webhooks). Every field is in {@link #toMap()}. */
public final class Referral extends WireObject {
  public Referral(@Nullable Map<String, ?> fields) {
    super(fields);
  }

  /** The referral ID ({@code rfl_...}). */
  public @Nullable String getId() {
    return string("id");
  }

  public @Nullable String getProgramId() {
    return string("program_id");
  }

  public @Nullable String getReferrerId() {
    return string("referrer_id");
  }

  /** {@code in_progress}, {@code holding}, {@code qualified}, {@code disqualified}, {@code rejected}, ... (a plain string: new statuses can appear). */
  public @Nullable String getStatus() {
    return string("status");
  }

  /** How the referee arrived: {@code link}, {@code code}, ... */
  public @Nullable String getSource() {
    return string("source");
  }

  public @Nullable String getMatchType() {
    return string("match_type");
  }

  /** The index of the qualification step the referee is on (0 is the first). */
  public int getCurrentStep() {
    Integer v = intNumber("current_step");
    return v == null ? 0 : v.intValue();
  }

  /** The qualification steps completed, in order. */
  public List<Step> getStepsCompleted() {
    return objects("steps_completed", Step::new);
  }

  public @Nullable Instant getStepDeadlineAt() {
    return instant("step_deadline_at");
  }

  public @Nullable Instant getHoldUntil() {
    return instant("hold_until");
  }

  public @Nullable Instant getQualifiedAt() {
    return instant("qualified_at");
  }

  public @Nullable Instant getDisqualifiedAt() {
    return instant("disqualified_at");
  }

  public @Nullable Instant getRejectedAt() {
    return instant("rejected_at");
  }

  /** Why the referral was disqualified or rejected, else null. */
  public @Nullable String getReason() {
    return string("reason");
  }

  /** The evidence of an {@code existing_user} rejection, else null. */
  public @Nullable String getReasonDetail() {
    return string("reason_detail");
  }

  /** {@link #getReasonDetail()} in words, else null. */
  public @Nullable String getReasonMessage() {
    return string("reason_message");
  }

  /** True when the referee uninstalled the app after the referral qualified (it stays qualified). */
  public boolean isRefereeUninstalledAfterQualification() {
    return Boolean.TRUE.equals(bool("referee_uninstalled_after_qualification"));
  }

  public @Nullable ProgramRef getProgram() {
    return object("program", ProgramRef::new);
  }

  public @Nullable ReferrerRef getReferrer() {
    return object("referrer", ReferrerRef::new);
  }

  public @Nullable Referee getReferee() {
    return object("referee", Referee::new);
  }

  /** The link the referee came through (wire {@code link.id}), else null. */
  public @Nullable String getLinkId() {
    Map<String, @Nullable Object> link = map("link");
    Object id = link == null ? null : link.get("id");
    return id instanceof String ? (String) id : null;
  }

  public @Nullable String getClickId() {
    return string("click_id");
  }

  /**
   * The program's reward as it was when the referral qualified (wire {@code reward_snapshot}); null when there was
   * none.
   */
  public @Nullable RewardInfo getReward() {
    return object("reward_snapshot", RewardInfo::new);
  }

  public @Nullable Instant getCreatedAt() {
    return instant("created_at");
  }

  public @Nullable Instant getUpdatedAt() {
    return instant("updated_at");
  }

  public @Nullable Boolean getLivemode() {
    return bool("livemode");
  }

  /** The referral's program ({@code program}). */
  public static final class ProgramRef extends WireObject {
    public ProgramRef(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getId() {
      return string("id");
    }

    public @Nullable String getName() {
      return string("name");
    }
  }

  /** The referral's referrer ({@code referrer}). */
  public static final class ReferrerRef extends WireObject {
    public ReferrerRef(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getId() {
      return string("id");
    }

    /** Your user ID for the referrer (wire {@code customer_user_id}). */
    public @Nullable String getCustomerId() {
      return string("customer_user_id");
    }

    public @Nullable String getCode() {
      return string("code");
    }
  }

  /** The person who was referred ({@code referee}). */
  public static final class Referee extends WireObject {
    public Referee(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    public @Nullable String getInstallId() {
      return string("install_id");
    }

    public @Nullable String getInstallationId() {
      return string("installation_id");
    }

    /** Your user ID for the referee (wire {@code customer_user_id}), once known. */
    public @Nullable String getCustomerId() {
      return string("customer_user_id");
    }
  }

  /** A qualification step the referee completed. */
  public static final class Step extends WireObject {
    public Step(@Nullable Map<String, ?> fields) {
      super(fields);
    }

    /** The step's position in the program's steps (0 is the first). */
    public int getIndex() {
      Integer v = intNumber("index");
      return v == null ? 0 : v.intValue();
    }

    /** The step's goal key; null for an identify step. */
    public @Nullable String getGoal() {
      return string("goal");
    }

    /** True for an identify step. */
    public boolean isIdentify() {
      return Boolean.TRUE.equals(bool("identify"));
    }

    public @Nullable Instant getCompletedAt() {
      return instant("completed_at");
    }

    /** What completed it: {@code goal:<goal event id>} or {@code identify:<customer ID>}. */
    public @Nullable String getSourceId() {
      return string("source_id");
    }
  }
}
