/**
 * Webhook event IDs already handled. Delivery is at least once, so the same event can arrive again.
 * In your app: a table `clikgate_webhook_events (event_id PRIMARY KEY, received_at)`, where the unique key makes
 * `markNew` safe when two deliveries race.
 */
export class ProcessedEvents {
  private readonly eventIds = new Set<string>();

  /** True the first time an event ID is seen, false for a repeat delivery. */
  markNew(eventId: string): boolean {
    if (this.eventIds.has(eventId)) return false;
    this.eventIds.add(eventId);
    return true;
  }
}

export interface Reward {
  referralId: string;
  referrerUserId: string;
  refereeUserId: string | null;
  amount: string;
  status: 'paid' | 'disqualified';
}

/** Your own rule. Here: ₦1,000 to the person who referred a friend. */
export const REWARD_AMOUNT = '1000';

/**
 * Referral rewards, one per referral. Clikgate never pays rewards: it tells your backend when to.
 * In your app: a table `referral_rewards (referral_id PRIMARY KEY, referrer_user_id, referee_user_id, amount, status,
 * paid_at)`. The primary key on the referral ID is what makes "pay once" hold.
 */
export class RewardStore {
  private readonly rewardsByReferral = new Map<string, Reward>();

  /** Records the payout once per referral; false when this referral already has a record. */
  payOnce(referralId: string, referrerUserId: string, refereeUserId: string | null): boolean {
    if (this.rewardsByReferral.has(referralId)) return false;
    this.rewardsByReferral.set(referralId, { referralId, referrerUserId, refereeUserId, amount: REWARD_AMOUNT, status: 'paid' });
    return true;
  }

  /** The referral didn't make it: record that nothing is owed. A paid referral is final and stays paid. */
  markDisqualified(referralId: string, referrerUserId: string, refereeUserId: string | null): void {
    if (this.rewardsByReferral.has(referralId)) return;
    this.rewardsByReferral.set(referralId, { referralId, referrerUserId, refereeUserId, amount: '0', status: 'disqualified' });
  }

  find(referralId: string): Reward | undefined {
    return this.rewardsByReferral.get(referralId);
  }

  paidCount(): number {
    return [...this.rewardsByReferral.values()].filter((reward) => reward.status === 'paid').length;
  }
}
