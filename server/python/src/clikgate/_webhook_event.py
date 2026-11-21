"""Verified webhook events with typed accessors (SPEC section 29)."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional, TypedDict, Union, cast

from ._currency import to_referral, to_referrer
from ._models import ConversionObject, DeviceChange, Install, PaymentReport, Referral, Referrer, WebhookGoalEvent

__all__ = ["TypedWebhookEvent", "WebhookEvent"]


class WebhookEvent(Dict[str, Any]):
    """A verified webhook event: a ``dict`` (``event["type"]`` keeps working) with read-only attributes and typed accessors.

    Each ``as_…()`` accessor gives the typed ``data.object`` for its family of event types, or ``None`` for any other event.

    Example::

        event = webhooks.verify(body, header, secret)
        referral = event.as_referral()
        if referral is not None and event.type == EventType.REFERRAL_QUALIFIED:
            grant_reward(referral["referrer"]["customer_id"])
    """

    @property
    def id(self) -> str:
        """The event's ID (``evt_…``); dedupe on it: delivery is at-least-once."""
        return cast(str, self.get("id"))

    @property
    def type(self) -> str:
        """e.g. ``referral.qualified``. Compare with :class:`EventType`."""
        return cast(str, self.get("type"))

    @property
    def api_version(self) -> str:
        return cast(str, self.get("api_version"))

    @property
    def created_at(self) -> str:
        return cast(str, self.get("created_at"))

    @property
    def organization_id(self) -> str:
        return cast(str, self.get("organization_id"))

    @property
    def livemode(self) -> bool:
        return cast(bool, self.get("livemode"))

    @property
    def data(self) -> Dict[str, Any]:
        """The raw ``data`` (``{"object": …, "previous_attributes": …}``)."""
        data = self.get("data")
        return data if isinstance(data, dict) else {}

    def _object(self, family: str) -> Optional[Dict[str, Any]]:
        t = self.get("type")
        if not isinstance(t, str) or not t.startswith(family + "."):
            return None
        obj = self.data.get("object")
        return obj if isinstance(obj, dict) else None

    def as_referral(self) -> Optional[Referral]:
        """``referral.*``: the referral, with reward amounts; else ``None``."""
        obj = self._object("referral")
        return None if obj is None else to_referral(obj)

    def as_referrer(self) -> Optional[Referrer]:
        """``referrer.*``: the referrer; else ``None``."""
        o = self._object("referrer")
        return None if o is None else to_referrer(o)

    def as_goal_event(self) -> Optional[WebhookGoalEvent]:
        """``goal.completed`` / ``goal.reversed``: the goal event as webhooks show it; else ``None``."""
        return cast(Optional[WebhookGoalEvent], self._object("goal"))

    def as_install(self) -> Optional[Install]:
        """``install.*``: the install; else ``None``."""
        return cast(Optional[Install], self._object("install"))

    def as_payment(self) -> Optional[PaymentReport]:
        """``payment.*``: the payment report; else ``None``."""
        return cast(Optional[PaymentReport], self._object("payment"))

    def as_conversion(self) -> Optional[ConversionObject]:
        """``conversion.*``: the conversion; else ``None``."""
        return cast(Optional[ConversionObject], self._object("conversion"))

    def as_device_change(self) -> Optional[DeviceChange]:
        """``person.device_changed``: the device change; else ``None``."""
        if self.get("type") != "person.device_changed":
            return None
        obj = self.data.get("object")
        return cast(DeviceChange, obj) if isinstance(obj, dict) else None

    def typed(self) -> TypedWebhookEvent:
        """The same event typed as :data:`TypedWebhookEvent`, narrowed by ``e["type"] == "referral.qualified"``.

        Example::

            e = event.typed()
            if e["type"] == "referral.qualified":
                print(e["data"]["object"]["referrer"]["customer_user_id"])
        """
        return cast("TypedWebhookEvent", self)


class ReferralEventData(TypedDict, total=False):
    object: Referral
    previous_attributes: Optional[Dict[str, Any]]


class ReferralWebhookEvent(TypedDict, total=False):
    """A ``referral.*`` event."""

    id: str
    object: Literal["event"]
    type: Literal[
        "referral.created",
        "referral.disqualified",
        "referral.holding",
        "referral.qualified",
        "referral.referee_uninstalled",
        "referral.rejected",
        "referral.step_completed",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: ReferralEventData


class ReferrerEventData(TypedDict, total=False):
    object: Referrer
    previous_attributes: Optional[Dict[str, Any]]


class ReferrerWebhookEvent(TypedDict, total=False):
    """A ``referrer.*`` event."""

    id: str
    object: Literal["event"]
    type: Literal[
        "referrer.blocked",
        "referrer.created",
        "referrer.quality_changed",
        "referrer.unblocked",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: ReferrerEventData


class GoalEventData(TypedDict, total=False):
    object: WebhookGoalEvent
    previous_attributes: Optional[Dict[str, Any]]


class GoalWebhookEvent(TypedDict, total=False):
    """A ``goal.*`` event."""

    id: str
    object: Literal["event"]
    type: Literal[
        "goal.completed",
        "goal.reversed",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: GoalEventData


class InstallEventData(TypedDict, total=False):
    object: Install
    previous_attributes: Optional[Dict[str, Any]]


class InstallWebhookEvent(TypedDict, total=False):
    """A ``install.*`` event."""

    id: str
    object: Literal["event"]
    type: Literal[
        "install.attributed",
        "install.attribution_updated",
        "install.organic",
        "install.uninstall_reverted",
        "install.uninstalled",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: InstallEventData


class PaymentEventData(TypedDict, total=False):
    object: PaymentReport
    previous_attributes: Optional[Dict[str, Any]]


class PaymentWebhookEvent(TypedDict, total=False):
    """A ``payment.*`` event."""

    id: str
    object: Literal["event"]
    type: Literal[
        "payment.not_confirmed",
        "payment.refunded",
        "payment.rejected",
        "payment.verified",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: PaymentEventData


class ConversionEventData(TypedDict, total=False):
    object: ConversionObject
    previous_attributes: Optional[Dict[str, Any]]


class ConversionWebhookEvent(TypedDict, total=False):
    """A ``conversion.*`` event."""

    id: str
    object: Literal["event"]
    type: Literal[
        "conversion.attributed",
        "conversion.reversed",
        "conversion.unattributed",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: ConversionEventData


class DeviceChangeEventData(TypedDict, total=False):
    object: DeviceChange
    previous_attributes: Optional[Dict[str, Any]]


class DeviceChangeWebhookEvent(TypedDict, total=False):
    """A ``person.device_changed`` event."""

    id: str
    object: Literal["event"]
    type: Literal["person.device_changed"]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: DeviceChangeEventData


class OtherEventData(TypedDict, total=False):
    object: Dict[str, Any]
    previous_attributes: Optional[Dict[str, Any]]


class OtherWebhookEvent(TypedDict, total=False):
    """Every other event type this SDK release knows."""

    id: str
    object: Literal["event"]
    type: Literal[
        "ab_test.likely_winner",
        "alert.resolved",
        "alert.triggered",
        "app.push_credentials_invalid",
        "app.reengaged",
        "app_banner.paused",
        "app_banner.published",
        "campaign.paused",
        "campaign.resumed",
        "challenge.cancelled",
        "challenge.ended",
        "challenge.finalized",
        "challenge.scheduled",
        "challenge.started",
        "click.created",
        "code.redeemed",
        "credit_note.issued",
        "domain.group_changed",
        "domain.settings_updated",
        "domain.status_changed",
        "fraud.install_flagged",
        "funnel.stuck",
        "identity.duplicate_detected",
        "invoice.issued",
        "invoice.paid",
        "invoice.voided",
        "job.completed",
        "leaderboard.period_closed",
        "leaderboard.period_finalized",
        "leaderboard.rank_changed",
        "leaderboard.target_reached",
        "leaderboard.target_revoked",
        "link.archived",
        "link.created",
        "link.destination_changed",
        "link.expired",
        "link.flagged",
        "link.paused",
        "link.resumed",
        "link.stats.hourly",
        "link.updated",
        "organization.deleted",
        "organization.feature_changed",
        "organization.feature_data_purged",
        "partner.approved",
        "partner_earning.approved",
        "partner_payout.paid",
        "partner_reward.applied",
        "partner_reward.approved",
        "partner_reward.removed",
        "partner_reward.reversed",
        "privacy.request_completed",
        "receipt.issued",
        "sale.matched",
        "sale.refunded",
        "skan.postback_received",
        "subscription.activated",
        "subscription.cancelled",
        "subscription.changed",
        "subscription.expired",
        "subscription.grace_started",
        "subscription.renewed",
        "subscription.trial_converted",
        "subscription.trial_ended",
        "subscription.trial_extended",
        "subscription.trial_started",
        "subscription.updated",
        "usage.threshold_reached",
        "webhook.test",
        "webhook_endpoint.disabled",
        "whatsapp.conversation_attributed",
    ]
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: OtherEventData


#: Every webhook event this SDK release knows, discriminated by ``type`` (``event.typed()``).
TypedWebhookEvent = Union[
    ReferralWebhookEvent,
    ReferrerWebhookEvent,
    GoalWebhookEvent,
    InstallWebhookEvent,
    PaymentWebhookEvent,
    ConversionWebhookEvent,
    DeviceChangeWebhookEvent,
    OtherWebhookEvent,
]
