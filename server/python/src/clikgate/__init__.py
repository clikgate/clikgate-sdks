"""The official Clikgate server SDK for Python.

Example::

    from decimal import Decimal
    from clikgate import Clikgate

    clikgate = Clikgate()                      # reads CLIKGATE_API_KEY
    clikgate.goal("account_opened", click_id=click_id, reference="APP-55231", value=Decimal("2000000"))
"""

from . import webhooks
from ._ads_hashing import HashedIdentifiers, hash_for_ads
from ._click_ids import (
    BROWSER_ENGINES,
    CLICK_ID_HEADER,
    CLICK_ID_PATTERN,
    KEPT_BY,
    KEPT_COOKIE,
    PLATFORMS,
    ClickContext,
    ClickIds,
    KeepResponse,
    KeepRoute,
    click_ids,
    is_valid,
)
from ._client import AsyncClikgate, Clikgate, PersonIdentified
from ._core import ErrorContext, OnError
from ._enums import GoalKind, GoalStatus, Provider
from ._errors import (
    AuthenticationError,
    ClikgateError,
    ConfigurationError,
    ConflictError,
    IdempotencyError,
    InvalidRequestError,
    LinkLockedError,
    NetworkError,
    NotFoundError,
    PermissionError,
    PrivateModeFieldRejectedError,
    RateLimitError,
    ServerError,
    SignatureVerificationError,
    TimeoutError,
)
from ._goals import AsyncGoals, GoalBatchEvent, Goals
from ._http import Clock, RequestOptions
from ._money import MoneyInput, format_value
from ._payments import AsyncPayments, Payments, build_from_flutterwave, build_from_monnify, build_from_paystack, build_from_stripe
from ._resources import AsyncClicks, AsyncConversions, AsyncLinks, Clicks, Conversions, Links
from ._types import (
    Click,
    ConfigGoal,
    Conversion,
    GoalAttribution,
    GoalBatchItem,
    GoalBatchResult,
    GoalEvent,
    GoalPaymentInfo,
    Link,
    LinkChangeRequest,
    LinkPage,
    LinkUpdateResult,
    LinkWarning,
    PaymentConfirmation,
    PaymentConfirmationBody,
    QrCode,
    ServerSdkConfig,
    WebhookEvent,
)
from ._version import VERSION
from .webhooks import RawBody

__version__ = VERSION

#: Stable warning codes (SPEC section 15), passed as ``extra={"clikgate_code": code}``.
WARNING_CODES = (
    "inexact_number",
    "unknown_goal",
    "value_not_allowed",
    "value_required",
    "config_unavailable",
    "sdk_below_minimum_version",
    "queue_full_dropped",
    "unrecognised_payment_response",
)

__all__ = [
    "PersonIdentified",
    "CLICK_ID_HEADER",
    "CLICK_ID_PATTERN",
    "VERSION",
    "WARNING_CODES",
    "AsyncClicks",
    "AsyncClikgate",
    "AsyncConversions",
    "AsyncGoals",
    "AsyncLinks",
    "AsyncPayments",
    "AuthenticationError",
    "BROWSER_ENGINES",
    "Click",
    "ClickContext",
    "ClickIds",
    "Clicks",
    "Clikgate",
    "ClikgateError",
    "Clock",
    "ConfigGoal",
    "ConfigurationError",
    "ConflictError",
    "Conversion",
    "Conversions",
    "ErrorContext",
    "GoalAttribution",
    "GoalBatchEvent",
    "GoalBatchItem",
    "GoalBatchResult",
    "GoalEvent",
    "GoalKind",
    "GoalPaymentInfo",
    "GoalStatus",
    "HashedIdentifiers",
    "Goals",
    "IdempotencyError",
    "InvalidRequestError",
    "KEPT_BY",
    "KEPT_COOKIE",
    "KeepResponse",
    "KeepRoute",
    "Link",
    "LinkChangeRequest",
    "LinkLockedError",
    "LinkPage",
    "LinkUpdateResult",
    "LinkWarning",
    "Links",
    "MoneyInput",
    "NetworkError",
    "NotFoundError",
    "OnError",
    "PLATFORMS",
    "PaymentConfirmation",
    "PaymentConfirmationBody",
    "Payments",
    "PermissionError",
    "PrivateModeFieldRejectedError",
    "Provider",
    "QrCode",
    "RateLimitError",
    "RawBody",
    "RequestOptions",
    "ServerError",
    "ServerSdkConfig",
    "SignatureVerificationError",
    "TimeoutError",
    "WebhookEvent",
    "__version__",
    "build_from_flutterwave",
    "build_from_monnify",
    "build_from_paystack",
    "build_from_stripe",
    "click_ids",
    "format_value",
    "hash_for_ads",
    "is_valid",
    "webhooks",
]
