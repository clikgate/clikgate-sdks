package com.example.clikgate.webhooks;

import com.clikgate.model.EventType;
import com.clikgate.model.Referral;
import com.clikgate.model.WebhookEvent;
import org.springframework.stereotype.Component;

/**
 * Pays referral rewards from {@code referral.qualified} and {@code referral.disqualified}. {@code event.asReferral()}
 * gives the referral: its {@code id}, and the {@code referrer} and {@code referee} with {@code getCustomerId()} (your
 * own user IDs; the referee's is null until the app identified them).
 */
@Component
public class ReferralEvents {
  private final RewardStore rewards;

  public ReferralEvents(RewardStore rewards) {
    this.rewards = rewards;
  }

  // #region referral-event
  public void handleReferralEvent(WebhookEvent event) {
    boolean qualified = EventType.REFERRAL_QUALIFIED.equals(event.getType());
    boolean disqualified = EventType.REFERRAL_DISQUALIFIED.equals(event.getType());
    if (!qualified && !disqualified) {
      return; // only these two events pay or cancel a reward
    }
    Referral referral = event.asReferral(); // null for an event that isn't referral.*
    if (referral == null) {
      return;
    }
    String referrerUserId = referral.getReferrer() == null ? null : referral.getReferrer().getCustomerId();
    String refereeUserId = referral.getReferee() == null ? null : referral.getReferee().getCustomerId();
    if (referral.getId() == null || referrerUserId == null) {
      return; // not a referral we can pay
    }
    if (qualified) {
      // Final: pay once. In production, enqueue a job here and answer the webhook straight away.
      rewards.payOnce(referral.getId(), referrerUserId, refereeUserId);
    } else {
      rewards.markDisqualified(referral.getId(), referrerUserId, refereeUserId); // pay nothing
    }
  }
  // #endregion
}
