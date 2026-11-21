<?php

declare(strict_types=1);

namespace App\Webhooks;

use App\State;

/**
 * Referral rewards, one per referral. Clikgate never pays rewards: it tells your backend when to.
 * In your app: a table `referral_rewards (referral_id PRIMARY KEY, referrer_user_id, referee_user_id, amount, status,
 * paid_at)`. The primary key on the referral ID is what makes "pay once" hold.
 */
final class RewardStore
{
    /** Your own rule. Here: ₦1,000 to the person who referred a friend. */
    public const REWARD_AMOUNT = '1000';

    public function __construct(private readonly State $state) {}

    /** Records the payout once per referral; false when this referral already has a record. */
    public function payOnce(string $referralId, string $referrerUserId, ?string $refereeUserId): bool
    {
        return $this->recordOnce($referralId, $referrerUserId, $refereeUserId, self::REWARD_AMOUNT, 'paid');
    }

    /** The referral didn't make it: record that nothing is owed. A paid referral is final and stays paid. */
    public function markDisqualified(string $referralId, string $referrerUserId, ?string $refereeUserId): void
    {
        $this->recordOnce($referralId, $referrerUserId, $refereeUserId, '0', 'disqualified');
    }

    /** @return array<string, mixed>|null */
    public function find(string $referralId): ?array
    {
        return $this->state->tables['referral_rewards'][$referralId] ?? null;
    }

    public function paidCount(): int
    {
        return \count(array_filter($this->state->tables['referral_rewards'], static fn(array $r): bool => 'paid' === $r['status']));
    }

    private function recordOnce(string $referralId, string $referrerUserId, ?string $refereeUserId, string $amount, string $status): bool
    {
        if (isset($this->state->tables['referral_rewards'][$referralId])) {
            return false;
        }
        $this->state->tables['referral_rewards'][$referralId] = [
            'referral_id' => $referralId,
            'referrer_user_id' => $referrerUserId,
            'referee_user_id' => $refereeUserId,
            'amount' => $amount,
            'status' => $status,
        ];

        return true;
    }
}
