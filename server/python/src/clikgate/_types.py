"""Wire objects returned by the hand-written resources. Keys are as the API sends them (``snake_case``).

They are ``TypedDict``\\ s: results are plain ``dict``\\ s, typed for editors and mypy. Unlisted keys are kept.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, TypedDict, Union

from ._enums import GoalKind, GoalStatus

__all__ = [
    "PaymentConfirmation",
    "PaymentConfirmationBody",
    "Click",
    "ConfigGoal",
    "Conversion",
    "GoalAttribution",
    "GoalBatchItem",
    "GoalBatchResult",
    "GoalEvent",
    "GoalPaymentInfo",
    "Link",
    "LinkChangeRequest",
    "LinkPage",
    "LinkUpdateResult",
    "LinkWarning",
    "QrCode",
    "ServerSdkConfig",
    "WebhookEvent",
]


class GoalAttribution(TypedDict, total=False):
    """Where a goal event was attributed."""

    link_id: Optional[str]
    campaign_id: Optional[str]
    clicked_at: Optional[str]


class GoalPaymentInfo(TypedDict, total=False):
    """A Payment goal sent by your server: the trusted confirmation it became."""

    confirmation_id: str
    #: ``matched``, ``waiting_for_report``, ``duplicate``, … (a plain string: new values can appear)
    match_status: str
    report_id: Optional[str]
    provider: str


class GoalEvent(TypedDict, total=False):
    """A goal event (``POST /v1/goals/events``)."""

    object: Literal["goal_event"]
    #: The event id; ``pcf_...`` (the confirmation) while a Payment goal waits.
    id: str
    #: ``GoalStatus.COUNTED``, ``WAITING`` or ``REFUSED``; a status this release doesn't know stays a ``str``.
    status: Union[GoalStatus, str]
    #: The goal's kind: ``GoalKind.STANDARD`` or ``GoalKind.PAYMENT``.
    goal_kind: Union[GoalKind, str]
    #: True when the value was dropped (browser and app senders of a Payment goal).
    value_ignored: bool
    #: The conversion state: ``attributed``, ``unattributed``, ``rejected_bot``, …; ``None`` while a Payment goal waits.
    event_status: Optional[str]
    #: For a Payment goal sent by your server; else ``None``.
    payment: Optional[GoalPaymentInfo]
    goal: str
    #: Your reference; ``None`` in private mode.
    reference: Optional[str]
    #: Normal units as a decimal string, e.g. ``"2000000"``. Never a float.
    value: Optional[str]
    #: The same amount in the currency's minor units (kobo, cents), e.g. ``200000000``.
    #: ``None`` without a value.
    value_minor: Optional[int]
    currency: Optional[str]
    reversed_value: Optional[str]
    #: ``reversed_value`` in minor units; ``None`` when nothing was reversed.
    reversed_value_minor: Optional[int]
    first_for_click: Optional[bool]
    is_first: Optional[bool]
    #: ``status == GoalStatus.COUNTED``.
    counted: bool
    #: ``None`` when counted; else why, e.g. ``waiting_for_confirmation``, ``already_counted_for_click``.
    reason: Optional[str]
    unattributed_reason: Optional[str]
    duplicate_of_id: Optional[str]
    attributed_to: Optional[GoalAttribution]
    occurred_at: str
    received_at: str
    livemode: bool


class GoalBatchItem(TypedDict, total=False):
    """One item of a batch result."""

    index: int
    ok: bool
    status: int
    goal_event: Optional[GoalEvent]
    error: Optional[Dict[str, Any]]


class GoalBatchResult(TypedDict):
    """``POST /v1/goals/events/batch`` result: one item per event, in order."""

    object: Literal["list"]
    data: List[GoalBatchItem]


class LinkWarning(TypedDict, total=False):
    """A non-blocking finding on a link, e.g. ``no_preview``."""

    code: str
    message: str
    param: Optional[str]


class Link(TypedDict, total=False):
    """A link (``/v1/links``). Only the most used fields are listed; the rest are kept."""

    object: Literal["link"]
    id: str
    short_url: str
    domain: str
    slug: str
    status: str
    destination_url: str
    fallback_url: Optional[str]
    title: Optional[str]
    og_title: Optional[str]
    og_image_url: Optional[str]
    tags: List[str]
    metadata: Dict[str, Any]
    #: Non-blocking warnings, e.g. ``no_preview``.
    warnings: List[LinkWarning]
    #: ``"premium"`` on ``ciz.to`` links, else ``None``.
    domain_badge: Optional[Literal["premium"]]
    #: True when destination, fallback and deep-link changes are refused (``409 link_locked``).
    locked: bool
    created_at: str
    updated_at: str
    livemode: bool


class LinkChangeRequest(TypedDict, total=False):
    """A pending destination change awaiting a second person's approval (``202`` on update)."""

    object: Literal["link_change_request"]
    id: str
    link_id: str
    requested_by: str
    requested_by_type: str
    from_url: str
    to_url: str
    status: Literal["pending", "approved", "rejected", "expired"]
    decided_by: Optional[str]
    decided_at: Optional[str]
    decision_note: Optional[str]
    livemode: bool
    created_at: str
    expires_at: str


class LinkUpdateResult(TypedDict):
    """The result of ``links.update``: applied now (``applied``), or waiting for approval (``change_request``)."""

    applied: bool
    link: Optional[Link]
    change_request: Optional[LinkChangeRequest]
    warnings: List[LinkWarning]


class LinkPage(TypedDict):
    """One page of links."""

    object: Literal["list"]
    data: List[Link]
    has_more: bool
    next_cursor: Optional[str]


class Click(TypedDict, total=False):
    """A click (``/v1/clicks/{id}``)."""

    object: Literal["click"]
    id: str
    occurred_at: str
    link: Optional[Dict[str, Any]]
    campaign: Optional[Dict[str, Any]]
    country: Optional[str]
    device_type: Optional[str]
    is_suspected_bot: bool
    livemode: bool


class Conversion(TypedDict, total=False):
    """A conversion (older API). For a Payment goal ``conversions.create`` returns a ``GoalEvent`` instead (``object == "goal_event"``)."""

    object: Literal["conversion"]
    id: str
    status: str


class PaymentConfirmationBody(TypedDict, total=False):
    """The wire body of ``POST /v1/payments/confirmations``, as the payment builders return it (SPEC 22)."""

    provider: str
    reference: str
    status: str
    aliases: List[str]
    amount: str
    amount_minor: int
    currency: str
    occurred_at: str
    test: bool
    click_id: str
    goal: str


class PaymentConfirmation(TypedDict, total=False):
    """The ``payment_confirmation`` object."""

    object: Literal["payment_confirmation"]
    id: str
    provider: str
    reference: str
    status: str
    amount: Optional[str]
    amount_minor: Optional[int]
    currency: Optional[str]
    occurred_at: str
    route: str
    connection_id: Optional[str]
    match_status: str
    report_id: Optional[str]
    goal_event_id: Optional[str]
    test: bool
    received_at: str
    duplicate: Optional[bool]


class ConfigGoal(TypedDict, total=False):
    """A goal as ``GET /v1/server-sdk/config`` describes it."""

    key: str
    value_mode: Literal["none", "optional", "required"]
    default_currency: Optional[str]


class ServerSdkConfig(TypedDict, total=False):
    """``GET /v1/server-sdk/config``."""

    mode: Literal["live", "test"]
    organization_id: str
    private_mode: bool
    click_id_param: str
    goals: List[ConfigGoal]
    minimum_sdk_versions: Dict[str, str]


class WebhookEvent(TypedDict, total=False):
    """A webhook event."""

    id: str
    object: Literal["event"]
    #: e.g. ``goal.completed``, ``link.destination_changed``, ``subscription.updated``.
    type: str
    api_version: str
    created_at: str
    organization_id: str
    livemode: bool
    data: Dict[str, Any]


@dataclass(frozen=True)
class QrCode:
    """QR code bytes and their content type (``image/svg+xml`` or ``image/png``)."""

    content_type: str
    data: bytes
