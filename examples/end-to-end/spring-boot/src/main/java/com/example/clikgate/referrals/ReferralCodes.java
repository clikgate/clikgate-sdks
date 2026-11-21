package com.example.clikgate.referrals;

import com.fasterxml.jackson.annotation.JsonAlias;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Gets or creates a user's referrer code in your referral program. The same user always gets the same code, whether
 * your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
 */
@Component
public class ReferralCodes {
  /** Read from the API's {@code short_url}, sent to the app as {@code link}. */
  public record ReferralCode(String code, @JsonAlias("short_url") String link) {}

  private final RestClient http;
  private final String programId;

  public ReferralCodes(@Value("${clikgate.base-url}") String baseUrl, @Value("${clikgate.api-key}") String apiKey,
      @Value("${sample.referral-program-id}") String programId) {
    this.http = RestClient.builder().baseUrl(baseUrl).defaultHeader("Authorization", "Bearer " + apiKey).build();
    this.programId = programId; // one program ID in your configuration, never one per user
  }

  // #region referral-code
  public ReferralCode getOrCreateReferralCode(String userId) {
    // Clikgate SDK 2.1.0: replace with clikgate.referrals().getOrCreateReferrer(programId, userId) (a Referrer: getCode(), getShortUrl())
    // Until then: the same API call the SDK will make (201 when created, 200 when it already existed).
    return http.post()
        .uri("/v1/referral-programs/{programId}/referrers", programId)
        .contentType(MediaType.APPLICATION_JSON)
        .body(Map.of("customer_user_id", userId)) // your own user ID, exactly as the app's identifyUser sends it
        .retrieve()
        .body(ReferralCode.class);
  }
  // #endregion
}
