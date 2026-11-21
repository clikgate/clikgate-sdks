"""Typed models of the referrals, privacy, people, installs and codes resources (SPEC sections 28-32).

They are ``TypedDict``\\ s over the wire JSON (``snake_case`` keys): results are plain ``dict``\\ s, typed for editors and
mypy. Unknown keys are kept. ``amount`` (on reward sides) and ``created`` (on ``get_or_create_referrer``) are added by
the SDK.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict

from .api import (
    AddLinkSchema,
    ConversionInfoResponse,
    InstallInfoResponse,
    PaymentReportInfoResponse,
    PersonInfoResponse,
    PersonSummaryResponse,
    UpdateLinkSchema,
)

__all__ = [
    "CodeRedemption",
    "ConversionObject",
    "Install",
    "Job",
    "JobResult",
    "LinkCreateParams",
    "LinkUpdateParams",
    "PaymentReport",
    "Person",
    "PersonSearchPage",
    "PersonSummary",
    "PrivacyRequest",
    "Referral",
    "ReferralPage",
    "ReferralStep",
    "Referrer",
    "ReferrerImportRow",
    "ReferrerResult",
    "ReferrerStats",
    "RewardInfo",
    "RewardSide",
    "WebhookGoalEvent",
]

#: A person: one customer across clicks, installs and your customer ID (``people.get``).
Person = PersonInfoResponse
#: A person as ``people.search`` lists them.
PersonSummary = PersonSummaryResponse
#: An app install.
Install = InstallInfoResponse
#: A payment report decided by a trusted confirmation (``payment.*`` webhooks).
PaymentReport = PaymentReportInfoResponse
#: A conversion as ``conversion.*`` webhooks show it.
ConversionObject = ConversionInfoResponse
#: The fields of ``links.create`` (the API's ``AddLinkSchema``).
LinkCreateParams = AddLinkSchema
#: The fields of ``links.update`` (the API's ``UpdateLinkSchema``); ``None`` clears a field.
LinkUpdateParams = UpdateLinkSchema


class ReferrerStats(TypedDict, total=False):
    """A referrer's counters, refreshed regularly (not live)."""

    clicks: int
    #: Referrals of any status.
    installs: int
    signups: int
    in_progress: int
    qualified: int
    disqualified: int
    rejected: int
    #: Share of referees (0 to 1) who uninstalled within 7 days; ``None`` when none is old enough yet.
    referee_uninstall_rate_7d: Optional[float]


class Referrer(TypedDict, total=False):
    """A customer who refers others in a referral program."""

    object: Literal["referrer"]
    id: str
    program_id: str
    #: Your customer ID (the ``customer_id`` you passed), as the API names it.
    customer_user_id: str
    #: The same customer ID (added by the SDK).
    customer_id: str
    display_name: Optional[str]
    code: str
    external_code: Optional[str]
    link_id: Optional[str]
    #: The code URL, else the short link.
    url: Optional[str]
    short_url: Optional[str]
    #: ``active`` or ``blocked``.
    status: str
    blocked_reason: Optional[str]
    blocked_at: Optional[str]
    stats: ReferrerStats
    #: Your own free-form data about the referrer.
    attributes: Dict[str, Any]
    leaderboard_opt_out: bool
    quality_score: Optional[int]
    quality_band: Optional[str]
    last_activity_at: Optional[str]
    created_at: str
    updated_at: str
    livemode: bool


class ReferrerResult(Referrer, total=False):
    """A referrer from ``get_or_create_referrer``: ``created`` is true when it was just created (the API answered 201)."""

    created: bool


class RewardSide(TypedDict, total=False):
    """One side's reward. Keys without a value are absent."""

    #: The amount in the currency's minor units, as the API sends it.
    amount_minor: int
    currency: str
    #: The same amount in normal units, a decimal string with the currency's exponent (``"500.00"``). Added by the SDK.
    amount: str
    description: str


class RewardInfo(TypedDict, total=False):
    """Reward information, for your records: Clikgate never pays rewards."""

    referrer: RewardSide
    referee: RewardSide
    note: str


class ReferralStep(TypedDict, total=False):
    """A qualification step the referee completed."""

    index: int
    #: The step's goal key; absent for identify steps.
    goal: str
    #: True for an identify step; absent for goal steps.
    identify: bool
    completed_at: str
    source_id: Optional[str]


class ReferralProgramRef(TypedDict, total=False):
    id: str
    name: str


class ReferralReferrerRef(TypedDict, total=False):
    id: str
    customer_user_id: str
    #: The same customer ID (added by the SDK).
    customer_id: str
    code: str


class ReferralReferee(TypedDict, total=False):
    install_id: str
    installation_id: str
    customer_user_id: Optional[str]
    #: The same customer ID (added by the SDK); ``None`` until identified.
    customer_id: Optional[str]


class IdRef(TypedDict, total=False):
    id: str


class Referral(TypedDict, total=False):
    """A referral: an install matched to a referrer, and its progress through the program's steps."""

    object: Literal["referral"]
    id: str
    program_id: str
    referrer_id: str
    #: ``installed``, ``in_progress``, ``holding``, ``qualified``, ``disqualified``, ``rejected``, … (a plain string).
    status: str
    source: str
    match_type: Optional[str]
    current_step: int
    steps_completed: List[ReferralStep]
    step_deadline_at: Optional[str]
    hold_until: Optional[str]
    qualified_at: Optional[str]
    disqualified_at: Optional[str]
    rejected_at: Optional[str]
    reason: Optional[str]
    reason_detail: Optional[str]
    reason_message: Optional[str]
    fraud_flags: List[str]
    referee_uninstalled_after_qualification: bool
    program: ReferralProgramRef
    referrer: ReferralReferrerRef
    referee: ReferralReferee
    link: Optional[IdRef]
    click_id: Optional[str]
    #: The program's reward when the referral qualified; absent when there was none.
    reward_snapshot: RewardInfo
    created_at: str
    updated_at: str
    livemode: bool


class ReferralPage(TypedDict):
    """One page of referrals."""

    object: Literal["list"]
    data: List[Referral]
    has_more: bool
    next_cursor: Optional[str]


class JobError(TypedDict, total=False):
    type: str
    code: str
    message: str
    param: Optional[str]


class JobResult(TypedDict, total=False):
    """One result of a job (only the keys that apply are present)."""

    index: int
    ok: bool
    referrer_id: str
    link_id: str
    created: bool
    error: JobError


class Job(TypedDict, total=False):
    """A background job, e.g. a referrer import."""

    object: Literal["job"]
    id: str
    type: str
    status: str
    total: int
    succeeded: int
    failed: int
    results: List[JobResult]
    created_at: str
    finished_at: Optional[str]
    livemode: bool


class ReferrerImportRow(TypedDict, total=False):
    """One row of ``referrals.import_referrers`` (``customer_id`` is required)."""

    customer_id: str
    external_code: str
    display_name: str


class PrivacyRequest(TypedDict, total=False):
    """A privacy request (access, export, delete or erasure)."""

    object: Literal["privacy_request"]
    id: str
    app_id: Optional[str]
    type: str
    subject_type: str
    #: ``pending``, ``running``, ``completed`` or ``failed``.
    status: str
    #: Set once completed: an export's ``{download_url, expires_at, installs, goal_name_events}``, or an erasure's counts.
    result: Optional[Dict[str, Any]]
    error: Optional[str]
    created_at: str
    completed_at: Optional[str]
    livemode: bool


class PersonSearchPage(TypedDict):
    """One page of ``people.search``."""

    object: Literal["list"]
    data: List[PersonSummary]
    has_more: bool
    next_cursor: Optional[str]


class RedemptionCode(TypedDict, total=False):
    code: str
    kind: str
    link_id: Optional[str]
    campaign_id: Optional[str]
    referrer_id: Optional[str]
    program_id: Optional[str]


class ReferralError(TypedDict, total=False):
    code: str
    message: str


class CodeRedemption(TypedDict, total=False):
    """The answer of ``codes.redeem``."""

    object: Literal["code_redemption"]
    offline_touch_id: str
    code: RedemptionCode
    #: The referral the redemption created or found; ``None`` otherwise.
    referral: Optional[Referral]
    #: True once the touch is tied to an install.
    linked: bool
    #: Why a referral code didn't create a referral (e.g. ``already_referred``); ``None`` otherwise.
    referral_error: Optional[ReferralError]
    livemode: bool


class GoalGroupRef(TypedDict, total=False):
    id: str
    name: str


class PersonRef(TypedDict, total=False):
    id: str
    label: Optional[str]


class WebhookGoalEvent(TypedDict, total=False):
    """A goal event as ``goal.completed`` and ``goal.reversed`` webhooks show it."""

    object: Literal["goal_event"]
    id: str
    goal: Optional[str]
    #: Normal units as a decimal string.
    value: Optional[str]
    value_minor: Optional[int]
    currency: Optional[str]
    first_for_click: Optional[bool]
    is_first_customer: Optional[bool]
    link: Optional[IdRef]
    campaign: Optional[IdRef]
    clicked_at: Optional[str]
    occurred_at: str
    #: The attribution state, e.g. ``attributed``.
    status: str
    received_as: Optional[str]
    goal_group: Optional[GoalGroupRef]
    #: Your reference; absent in private mode.
    reference: Optional[str]
    person: Optional[PersonRef]
    backfilled: Optional[bool]
