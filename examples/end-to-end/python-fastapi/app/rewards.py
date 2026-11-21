"""The two small stores a backend keeps to pay referral rewards correctly. In memory here; tables in your app."""

from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Optional, Set

#: Your own rule. Here: ₦1,000 to the person who referred a friend.
REWARD_AMOUNT = Decimal("1000")


class ProcessedEvents:
    """Webhook event IDs already handled. Delivery is at least once, so the same event can arrive again.
    In your app: a table ``clikgate_webhook_events (event_id PRIMARY KEY, received_at)``, where the unique key makes
    ``mark_new`` safe when two deliveries race."""

    def __init__(self) -> None:
        self._event_ids: Set[str] = set()

    def mark_new(self, event_id: str) -> bool:
        """True the first time an event ID is seen, False for a repeat delivery."""
        if event_id in self._event_ids:
            return False
        self._event_ids.add(event_id)
        return True


@dataclass(frozen=True)
class Reward:
    referral_id: str
    referrer_user_id: str
    referee_user_id: Optional[str]
    amount: Decimal
    status: str  # "paid" or "disqualified"


class RewardStore:
    """Referral rewards, one per referral. Clikgate never pays rewards: it tells your backend when to.
    In your app: a table ``referral_rewards (referral_id PRIMARY KEY, referrer_user_id, referee_user_id, amount,
    status, paid_at)``. The primary key on the referral ID is what makes "pay once" hold."""

    def __init__(self) -> None:
        self._by_referral: Dict[str, Reward] = {}

    def pay_once(self, referral_id: str, referrer_user_id: str, referee_user_id: Optional[str]) -> bool:
        """Records the payout once per referral; False when this referral already has a record."""
        if referral_id in self._by_referral:
            return False
        self._by_referral[referral_id] = Reward(referral_id, referrer_user_id, referee_user_id, REWARD_AMOUNT, "paid")
        return True

    def mark_disqualified(self, referral_id: str, referrer_user_id: str, referee_user_id: Optional[str]) -> None:
        """The referral didn't make it: record that nothing is owed. A paid referral is final and stays paid."""
        self._by_referral.setdefault(
            referral_id, Reward(referral_id, referrer_user_id, referee_user_id, Decimal("0"), "disqualified")
        )

    def find(self, referral_id: str) -> Optional[Reward]:
        return self._by_referral.get(referral_id)

    def paid_count(self) -> int:
        return sum(1 for reward in self._by_referral.values() if reward.status == "paid")
