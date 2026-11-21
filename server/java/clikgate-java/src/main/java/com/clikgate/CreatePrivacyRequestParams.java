package com.clikgate;

import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The parameters of {@link Privacy#createRequest(CreatePrivacyRequestParams)}.
 *
 * <pre>{@code
 * CreatePrivacyRequestParams.builder().type("erasure").subjectType("customer_user").subjectId(user.getId()).build();
 * }</pre>
 */
public final class CreatePrivacyRequestParams {
  final @Nullable String type;
  final @Nullable String subjectType;
  final @Nullable String subjectId;
  final @Nullable String appId;

  private CreatePrivacyRequestParams(Builder b) {
    type = b.type;
    subjectType = b.subjectType;
    subjectId = b.subjectId;
    appId = b.appId;
  }

  public static Builder builder() {
    return new Builder();
  }

  Map<String, Object> wire() {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("type", com.clikgate.internal.Requester.requireId(type, "type"));
    m.put("subject_type", com.clikgate.internal.Requester.requireId(subjectType, "subject_type"));
    m.put("subject_id", com.clikgate.internal.Requester.requireId(subjectId, "subject_id"));
    if (appId != null) {
      m.put("app_id", appId);
    }
    return m;
  }

  /** Builder for {@link CreatePrivacyRequestParams}. */
  public static final class Builder {
    private @Nullable String type;
    private @Nullable String subjectType;
    private @Nullable String subjectId;
    private @Nullable String appId;

    Builder() {}

    /** Required: {@code access}, {@code export}, {@code delete} or {@code erasure}. */
    public Builder type(String type) {
      this.type = type;
      return this;
    }

    /** Required: {@code installation}, {@code customer_user}, {@code email}, {@code phone}, {@code person} or {@code click}. */
    public Builder subjectType(String subjectType) {
      this.subjectType = subjectType;
      return this;
    }

    /** Required: the subject's ID of that type. */
    public Builder subjectId(String subjectId) {
      this.subjectId = subjectId;
      return this;
    }

    /** The app, for an installation subject. */
    public Builder appId(@Nullable String appId) {
      this.appId = appId;
      return this;
    }

    public CreatePrivacyRequestParams build() {
      return new CreatePrivacyRequestParams(this);
    }
  }
}
