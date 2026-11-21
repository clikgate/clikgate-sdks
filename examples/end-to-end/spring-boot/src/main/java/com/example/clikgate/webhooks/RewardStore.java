package com.example.clikgate.webhooks;

import java.math.BigDecimal;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Referral rewards, one per referral. Clikgate never pays rewards: it tells your backend when to.
 * In your app: a table {@code referral_rewards (referral_id PRIMARY KEY, referrer_user_id, referee_user_id, amount,
 * status, paid_at)}. The primary key on the referral ID is what makes "pay once" hold.
 */
@Component
public class RewardStore {
  /** Your own rule. Here: ₦1,000 to the person who referred a friend. */
  public static final BigDecimal REWARD_AMOUNT = new BigDecimal("1000");

  public enum Status { PAID, DISQUALIFIED }

  public record Reward(String referralId, String referrerUserId, String refereeUserId, BigDecimal amount, Status status) {}

  private final Map<String, Reward> rewardsByReferral = new ConcurrentHashMap<>();

  /** Records the payout once per referral; false when this referral already has a record. */
  public boolean payOnce(String referralId, String referrerUserId, String refereeUserId) {
    Reward reward = new Reward(referralId, referrerUserId, refereeUserId, REWARD_AMOUNT, Status.PAID);
    return rewardsByReferral.putIfAbsent(referralId, reward) == null;
  }

  /** The referral didn't make it: record that nothing is owed. A paid referral is final and stays paid. */
  public void markDisqualified(String referralId, String referrerUserId, String refereeUserId) {
    Reward none = new Reward(referralId, referrerUserId, refereeUserId, BigDecimal.ZERO, Status.DISQUALIFIED);
    rewardsByReferral.putIfAbsent(referralId, none);
  }

  public Optional<Reward> find(String referralId) {
    return Optional.ofNullable(rewardsByReferral.get(referralId));
  }

  public long paidCount() {
    return rewardsByReferral.values().stream().filter(r -> r.status() == Status.PAID).count();
  }
}
