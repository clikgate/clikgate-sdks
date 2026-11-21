using System.Collections.Concurrent;

namespace Sample;

/// <summary>
/// Webhook event IDs already handled. Delivery is at least once, so the same event can arrive again.
/// In your app: a table <c>clikgate_webhook_events (event_id PRIMARY KEY, received_at)</c>, where the unique key
/// makes MarkNew safe when two deliveries race.
/// </summary>
public sealed class ProcessedEvents
{
    private readonly ConcurrentDictionary<string, DateTimeOffset> _eventIds = new();

    /// <summary>True the first time an event ID is seen, false for a repeat delivery.</summary>
    public bool MarkNew(string eventId) => _eventIds.TryAdd(eventId, DateTimeOffset.UtcNow);
}

public sealed record Reward(string ReferralId, string ReferrerUserId, string? RefereeUserId, decimal Amount, string Status);

/// <summary>
/// Referral rewards, one per referral. Clikgate never pays rewards: it tells your backend when to.
/// In your app: a table <c>referral_rewards (referral_id PRIMARY KEY, referrer_user_id, referee_user_id, amount,
/// status, paid_at)</c>. The primary key on the referral ID is what makes "pay once" hold.
/// </summary>
public sealed class RewardStore
{
    /// <summary>Your own rule. Here: ₦1,000 to the person who referred a friend.</summary>
    public const decimal RewardAmount = 1000m;

    private readonly ConcurrentDictionary<string, Reward> _rewardsByReferral = new();

    /// <summary>Records the payout once per referral; false when this referral already has a record.</summary>
    public bool PayOnce(string referralId, string referrerUserId, string? refereeUserId) =>
        _rewardsByReferral.TryAdd(referralId, new Reward(referralId, referrerUserId, refereeUserId, RewardAmount, "paid"));

    /// <summary>The referral didn't make it: record that nothing is owed. A paid referral is final and stays paid.</summary>
    public void MarkDisqualified(string referralId, string referrerUserId, string? refereeUserId) =>
        _rewardsByReferral.TryAdd(referralId, new Reward(referralId, referrerUserId, refereeUserId, 0m, "disqualified"));

    public Reward? Find(string referralId) => _rewardsByReferral.GetValueOrDefault(referralId);

    public int PaidCount() => _rewardsByReferral.Values.Count(r => r.Status == "paid");
}
