package com.example.clikgate.webhooks;

import com.clikgate.model.WebhookEvent;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Pays referral rewards from {@code referral.qualified} and {@code referral.disqualified}. The event's
 * {@code data.object} is the referral: its {@code id}, and the {@code referrer} and {@code referee} with their
 * {@code customer_user_id} (your own user IDs).
 */
@Component
public class ReferralEvents {
  private final RewardStore rewards;

  public ReferralEvents(RewardStore rewards) {
    this.rewards = rewards;
  }

  // #region referral-event
  public void handleReferralEvent(WebhookEvent event) {
    // Clikgate SDK 2.1.0: replace with the typed referral event from the SDK instead of reading the map
    Object referral = path(event.getData(), "object");
    String referralId = text(referral, "id");
    String referrerUserId = text(path(referral, "referrer"), "customer_user_id");
    String refereeUserId = text(path(referral, "referee"), "customer_user_id");
    if (referralId == null || referrerUserId == null) {
      return; // not a referral we can pay
    }
    if ("referral.qualified".equals(event.getType())) {
      // Final: pay once. In production, enqueue a job here and answer the webhook straight away.
      rewards.payOnce(referralId, referrerUserId, refereeUserId);
    } else if ("referral.disqualified".equals(event.getType())) {
      rewards.markDisqualified(referralId, referrerUserId, refereeUserId); // pay nothing
    }
  }
  // #endregion

  private static Object path(Object node, String key) {
    return node instanceof Map<?, ?> map ? map.get(key) : null;
  }

  private static String text(Object node, String key) {
    return path(node, key) instanceof String value ? value : null;
  }
}
