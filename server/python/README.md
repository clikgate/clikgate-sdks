# clikgate (Python)

The official Clikgate server SDK for Python. It:

- sends goals in three lines;
- keeps the click ID;
- verifies webhooks;
- has private mode built in.

It supports Python 3.9+, has one dependency (`httpx`), ships full type hints (`py.typed`, mypy strict), and offers a sync `Clikgate` and an async `AsyncClikgate`.

```bash
pip install clikgate
```

```python
from decimal import Decimal
from clikgate import Clikgate

clikgate = Clikgate()                      # reads CLIKGATE_API_KEY (cg_live_… or cg_test_…)
clikgate.goal("account_opened", click_id=click_id, reference="APP-55231", value=Decimal("2000000"))
```

Create one client and reuse it. It is thread-safe.

- **`goal()`** is the one method for goals and payments. It never raises: it queues the event, and a daemon thread sends it in batches with safe retries.
- **`goals.send()`** waits for the API and returns the result: `status` is `GoalStatus.COUNTED`, `WAITING`, `RECEIVED` or `REFUSED` (with `reason`), plus `goal_kind`, `attributed_to`, … `received` means the name isn't ticked as a goal in the dashboard yet (or the goal is archived): it is stored, not counted, and shows in "Seen from your app and website". Every status is a result, never an error, and none is retried. Goals work on every plan, up to the plan's allowance.

```python
from clikgate import GoalKind, GoalStatus, Provider

event = clikgate.goals.send("order_paid", reference="T123456", value="7500", currency="NGN", provider=Provider.PAYSTACK, click_id=click_id)
if event["status"] == GoalStatus.COUNTED:            # members are str: == "counted" works too
    ...
elif event["goal_kind"] == GoalKind.PAYMENT and event["status"] == GoalStatus.WAITING:
    ...                                              # a Payment goal waiting for its confirmation
```

`GoalKind`, `GoalStatus` and `Provider` are `str` enums generated from the API. A value this release doesn't know (a newer status, or a gateway added later) stays a plain `str`, and `provider` also takes a provider-key string such as `"acme_pay"`.


### Match by hashed email or phone (ad networks)

When the business has turned on matching by hashed email or phone for an ad network destination, a goal can carry your own SHA-256 hashes: `hashed_email`, `hashed_phone_e164` and `hashed_phone_digits`. `hash_for_ads` makes them on your server (offline, no client needed) and returns only the fields for the values you give, ready to pass to `goal()` or `goals.send()`:

```python
from clikgate import hash_for_ads

clikgate.goal(
    "account_opened",
    reference="APP-55231",
    click_id=click_id,
    **hash_for_ads(email="ada.obi@example.com", phone="+234 803 123 4567"),
)
```

The email is trimmed and lowercased. The phone must include its country code (`+234…` or `00234…`); a national number such as `0803 123 4567` is an `InvalidRequestError` (`invalid_argument`), and the SDK never guesses the country. A hashed value that isn't 64 lowercase hex characters is refused before sending (`invalid_hashed_identifier`). `conversions.create` takes the same fields. Hashed values are never logged.

In private mode, hash on your own server: Clikgate never hashes for you there.

## End to end

A Django app that signs users in, counts goals and payments, runs a referral program and handles webhooks, with typed methods only:

```python
import os
from decimal import Decimal

from django.http import HttpResponse, JsonResponse
from clikgate import Clikgate, EventType, SignatureVerificationError, create_identity_token, webhooks

clikgate = Clikgate()   # CLIKGATE_API_KEY; CLIKGATE_IDENTITY_SECRET for identity tokens
PROGRAM_ID = "rpg_01J…"


def sign_in(request):
    user = authenticate_from_your_own_form(request)   # your own sign-in check
    # Path A: an identity token in the response; the app passes it to the mobile SDK.
    token = create_identity_token(str(user.id), customer_since=user.date_joined)
    # Path B: the app's Clikgate-Installation header, with the customer ID from your own session.
    clikgate.identify_user(installation=request.headers.get("Clikgate-Installation"), customer_id=str(user.id))
    # The customer's referral code and link (created the first time).
    referrer = clikgate.referrals.get_or_create_referrer(PROGRAM_ID, customer_id=str(user.id), display_name=user.first_name)
    return JsonResponse({"clikgate_identity_token": token, "referral_code": referrer["code"], "referral_url": referrer["url"]})


def application_approved(application):
    clikgate.goal("account_opened", click_id=application.click_id, reference=application.ref, value=Decimal("2000000"))


def order_paid(order, verify_response):
    # After your own GET /transaction/verify/{reference} with Paystack.
    clikgate.payments.from_paystack(verify_response, goal="order_paid", click_id=order.click_id)
    # Or any gateway: clikgate.payments.confirm(provider="paystack", reference=order.ref, status="success", amount=order.total, currency="NGN")


def clikgate_webhook(request):
    try:
        event = webhooks.verify(request.body, request.headers.get("Clikgate-Signature"), os.environ["CLIKGATE_WEBHOOK_SECRET"])
    except SignatureVerificationError as err:
        return HttpResponse(err.code, status=400)
    referral = event.as_referral()                     # None for any other event type
    if referral is not None and event.type == EventType.REFERRAL_QUALIFIED:
        reward = (referral.get("reward_snapshot") or {}).get("referrer") or {}
        credit_wallet(referral["referrer"]["customer_id"], reward.get("amount"), reward.get("currency"))   # "500.00", "NGN"
    goal = event.as_goal_event()
    if goal is not None and event.type == EventType.GOAL_COMPLETED:
        record_sale(goal["goal"], goal["value"])       # dedupe on event.id: delivery is at-least-once
    return HttpResponse(status=200)
```

## Identify your users

Two ways to tell Clikgate which of your users is using the app. Full guide: https://clikgate.com/docs/identify-users. The customer ID is your own user ID from your database, never an email, phone number or ID number. Anonymous users don't need either path.

**Path A (default): identity token.** Create the identity secret in Developers › SDKs › your app › Set up identity › Identity secret and store it as `CLIKGATE_IDENTITY_SECRET` on your server only. `create_identity_token(customer_id, app_id=None)` (also `clikgate.create_identity_token()`, with the `identity_secret` / `identity_secrets` options) signs a token with no network call; return it in the responses the app already calls, and the app passes it to the mobile SDK's `identifyUser()`. Tokens last 30 days by default and are never force-refreshed. Throws `ClikgateServerOnlyError` in browser or mobile Python builds (Pyodide, WASI, iOS, Android).

```python
from clikgate import create_identity_token
# sign-in and "current user" responses: one extra field
return {"user": user, "clikgate_identity_token": create_identity_token(str(user.id))}   # reads CLIKGATE_IDENTITY_SECRET
create_identity_token(str(user.id), app_id="app_…")                                    # several apps: CLIKGATE_IDENTITY_SECRETS
```

**Path B: the installation header, no secret or token.** The mobile SDK gives your app a `Clikgate-Installation` header (`<app_id>:<installation_id>`, not a secret), which the app sends to your server with its sign-in request and signed-in requests. After your own sign-in check succeeds, and at every signed-in app open, pass it to `identify_user` as `installation` with your signed-in user's ID. Your server never needs to know which Clikgate app ID belongs to which platform. Clikgate accepts installations active in the last 7 days.

- **The customer ID always comes from your own authenticated user.** The header only names the app installation. Call `identify_user` only after your sign-in check succeeds, and never read the customer ID from the request.
- **A missing or invalid header is ignored** (`None`, never an error or a log line): skip the call. Parsing is strict: `app_…`, one colon, a lowercase UUID, at most 128 characters, trimmed.
- **`app_id` is optional.** With only an installation ID, Clikgate finds the app. If the same installation ID is active in several of your apps (iOS apps sharing a Keychain access group can share one), the API answers `409 installation_in_several_apps`, a `ConflictError` with param `app_id`: send `app_id` too.

```python
# Django (the middleware sets request.clikgate_installation: an Installation or None)
user = authenticate(request, username=form["email"], password=form["password"])  # your own sign-in check first
if user is not None and request.clikgate_installation:
    clikgate.identify_user(installation=request.clikgate_installation, customer_id=str(user.id))  # the parsed installation

# Any framework: pass the raw header value (ignored when missing or invalid)
clikgate.identify_user(installation=request.headers.get("Clikgate-Installation"), customer_id=str(user.id))
# Or parse it yourself: Installation(app_id, installation_id) or None
inst = parse_installation_header(request.headers.get("Clikgate-Installation"))
```
## Customers from before Clikgate

Tell Clikgate who was already your customer before you added it, so they are never counted as a referral or a new customer. Send the account's creation date with the identity token (version 2) or from your server, and import the rest of your existing customers once. Use your own customer IDs, never emails or phone numbers: Clikgate stores a keyed fingerprint of each imported ID, not the ID itself. Not available in private mode. Guide: https://clikgate.com/docs/identify-users.

```python
token = create_identity_token(str(user.id), customer_since=user.created_at)  # version 2
clikgate.identify_user(installation=request.headers.get("Clikgate-Installation"), customer_id=str(user.id), customer_since=user.created_at)
result = clikgate.known_customers.import_customers([{"customer_id": "u_10482", "customer_since": "2024-03-02"}])  # batches of 10,000
print(result["accepted"], result["refused_by_reason"])  # refused rows are counted by reason, never returned
```

## People: identify a user and label them

Link a click, an app installation or your customer ID to a person, and give them a label your team sees instead of the click ID (1-80 characters; Growth and up). From your server this is always verified. Goals take the same `label`, and `isFirst` from your server is what counts a new customer. Don't put information in labels that your customers wouldn't expect you to keep.

```python
clikgate.identify_user(click_id=order.click_id, customer_id="user_42", label="Ada (VIP)")
clikgate.goal("account_opened", click_id=click_id, reference="APP-55231", is_first=True, label="Ada (VIP)")
```

## Keep the click ID

The pattern is: capture it on landing, save it with your own record, then send the goal later from any job.

| Framework | Install | Usage | Read it |
|---|---|---|---|
| Django | `pip install "clikgate[django]"` | add `"clikgate.django.ClikgateMiddleware"` to `MIDDLEWARE` | `request.clikgate_click_id` |
| Flask | `pip install "clikgate[flask]"` | `from clikgate.flask import Clikgate; Clikgate(app)` | `g.clikgate_click_id` |
| FastAPI / Starlette | `pip install "clikgate[fastapi]"` | `app.add_middleware(ClikgateMiddleware, client=clikgate)` from `clikgate.fastapi` | `Depends(click_id)` |

Each add-on keeps a click ID that arrives as `?cgid=…` in the first-party `_cg_cgid` cookie, which the web script also reads. The extras add no dependencies to the core package.

```python
# Django: save it with your record…
Application.objects.create(reference="APP-55231", click_id=request.clikgate_click_id)

# …and days later, when the account is approved, from any job:
from clikgate.django import get_client
get_client().goal("account_opened", click_id=app.click_id, reference=app.reference, value=Decimal("2000000"), currency="NGN")
```

- **Without a framework:** `clikgate.click_ids.from_request(request)` and `clikgate.click_ids.persist(response, click_id, request=request)`.
- **The app's installation** (`Clikgate-Installation` header, for `identify_user`): Django `request.clikgate_installation`, Flask `g.clikgate_installation`, FastAPI / Starlette `Depends(installation)` from `clikgate.fastapi`, and without a framework `installation_from_request(request)` or `parse_installation_header(value)`. Each is an `Installation(app_id, installation_id)` or `None`, and can be passed to `identify_user` as `installation`, like the raw header.
- **From payment payloads** (Paystack, Flutterwave, Shopify, WooCommerce): `clikgate.click_ids.from_payment_metadata(payload)`.

## Keep the click ID longer (Safari)

Safari, and every browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it, it lasts as long as you choose, up to the browser's limit.

Add a `/cg/keep` route to your server and tell the web script about it with `data-server-endpoint="/cg/keep"`. When a click ID arrives in the page URL, the script makes one `POST` to that route, and your server sets the `_cg_<param>` cookie (30 days by default, `days` up to 400) plus a small `_cg_kept=s` marker, so goals report `kept_by="server_cookie"`.

- **Same server:** the route must be served by the same host as the website (the page's own origin, e.g. `https://shop.example.com/cg/keep`), not by another domain or subdomain. A cookie set by another host doesn't get the longer lifetime.
- **Readable by the page on purpose:** both cookies are not `HttpOnly`, because the web script reads them. They are `SameSite=Lax` and `Secure` (default `True` here; pass `secure=False` only for local `http://` development).
- **Locked down:** only a same-origin `POST` (`Sec-Fetch-Site: same-origin`, or an `Origin` equal to the request's host) with a valid click ID that matches the page URL's is accepted. Every answer is `Cache-Control: no-store, private` with an empty body; it never redirects, and the input is never echoed or logged. The cookie name comes from your configuration (`click_id_param`, else `cgid`), never from the request.

```html
<script src="https://sdk.clikgate.com/v1/static/clikgate.js" data-web-key="cgw_live_…" data-server-endpoint="/cg/keep" async></script>
```

**Django** (the view is CSRF-exempt on purpose: it checks the origin itself and only sets the cookie):

```python
# urls.py
from clikgate.django import keep_view

urlpatterns = [
    path("cg/keep", keep_view()),          # or keep_view(days=90)
    # …
]

# settings.py: the middleware also keeps ?cgid=… from the query on any page (and writes the marker)
MIDDLEWARE = [..., "clikgate.django.ClikgateMiddleware"]
```

**Flask:** `app.add_url_rule("/cg/keep", "clikgate_keep", keep_view(), methods=["POST"])` with `from clikgate.flask import keep_view`.

**FastAPI / Starlette:** `app.add_api_route("/cg/keep", keep_endpoint(client=clikgate), methods=["POST"])` with `from clikgate.fastapi import keep_endpoint` (Starlette: `Route("/cg/keep", keep_endpoint(client=clikgate), methods=["POST"])`).

**Anything else:** `route = clikgate.click_ids.keep_route()`, then `route.handle_keep(method, headers, body)` returns `(status, headers, body)` to send as is (read at most 1025 bytes of the body).

Then send what you know about how it was kept with the goal. `click_ids.context(request)` returns `{"click_id", "kept_by", "browser_engine", "platform"}`; the engine and platform are worked out from the `User-Agent` in the SDK (the User-Agent itself is never sent), and all three are allowed in private mode:

```python
clikgate.goal("account_opened", reference=application.reference, **clikgate.click_ids.context(request))
```

`kept_by` is `server_cookie` (your server set the cookie), `script_cookie` (the web script did), `form` (the `Clikgate-Click-Id` header) or `None`; you can also pass `"payment_metadata"` or `"unknown"` yourself. `persist()` and the framework add-ons also write the `_cg_kept=s` marker.

## Money

- `value` is in **normal units** (₦2,000,000 is `2000000`, never kobo) and is always sent as a decimal string.
- It accepts `Decimal`, `int` or `str`. A `float` raises `TypeError`, because floats can't hold exact amounts.

## Payment goals

A goal is **Standard** or **Payment** (`GoalKind`), set in the goal's settings, never in the call. A Payment goal counts only when a trusted source confirms it:

- Your website or app **reports** the payment with `goal()` on the Payment goal, with `provider` and `reference` (never an amount). It waits for the confirmation (`status: waiting`).
- Your server **confirms** it, either with the payments helpers below, or by sending the same Payment goal with the confirmed value: `clikgate.goals.send("order_paid", reference="T123456", value="7500", currency="NGN", provider=Provider.PAYSTACK)`. It is counted at once with a `click_id`, and otherwise waits for the report.

Call the helper **right after your own server has verified the payment with
the gateway**, with the gateway's verified response. Never pass data from the browser or the app. The helper sends
only the reference, status, amount, currency, time and `cg_click_id`. It never sends customer details, and it
never needs your gateway key.

```python
# Paystack: after your own GET /transaction/verify/{reference}
clikgate.payments.from_paystack(verify_response, goal="order_paid")
# Flutterwave: after your own GET /v3/transactions/{id}/verify
clikgate.payments.from_flutterwave(verify_response)
# Monnify: after your own GET /api/v2/transactions/{transactionReference}
clikgate.payments.from_monnify(status_response)
# Stripe: a PaymentIntent you retrieved, or the Checkout Session from a webhook you verified
clikgate.payments.from_stripe(payment_intent)

# Any other gateway, or a refund:
clikgate.payments.confirm(provider=Provider.PAYSTACK, reference="T_ref_001", status="refunded", amount="2500.00", currency="NGN")
```

- Amounts are exact decimals, never floats: Paystack's `750000` kobo becomes `"7500"`.
- Raw JSON text is parsed with `Decimal`.
- The helpers return `None` (and send nothing) when the response has no reference or no known status.
  `build_from_paystack(...)` and the other builders return the body without sending it.
- `AsyncClikgate` has the same methods (`await`).
- Private mode allows every field these send.
- Payments need the Starter plan or above: on Free the API answers `403 plan_feature_unavailable` (`PermissionError`, `required_plan == "starter"`).
- `provider` and `reference` are required on a Payment goal (`422 payment_goal_needs_confirmation`, with `missing`); the SDK can't check it, because the kind lives only in the goal's settings. `conversions.create(goal=...)` on a Payment goal is the same confirmation and returns the goal event (`result["object"] == "goal_event"`).

## Webhooks

```python
from clikgate import EventType, webhooks, SignatureVerificationError

event = webhooks.verify(request.body, request.headers.get("Clikgate-Signature"), os.environ["CLIKGATE_WEBHOOK_SECRET"])
referral = event.as_referral()                  # a typed Referral, or None for other event types
if referral is not None and event.type == EventType.REFERRAL_QUALIFIED:
    ...
```

- Pass the **raw** body (`request.body` in Django, `request.get_data()` in Flask, `await request.body()` in Starlette).
- Deliveries are at-least-once: dedupe on `event.id`.
- `event` is a `WebhookEvent`: a `dict` (`event["data"]["object"]` keeps working) with the attributes `id`, `type`, `api_version`, `created_at`, `organization_id`, `livemode` and `data`.
- Typed accessors give `data.object` for their family of events, or `None` for any other: `as_referral()` (`referral.*`, with reward `amount`s), `as_referrer()` (`referrer.*`), `as_goal_event()` (`goal.completed`, `goal.reversed`), `as_install()` (`install.*`), `as_payment()` (`payment.*`), `as_conversion()` (`conversion.*`) and `as_device_change()` (`person.device_changed`).
- `EventType` lists every event type (`EventType.REFERRAL_QUALIFIED == "referral.qualified"`). `event.typed()` returns the event typed as the `TypedWebhookEvent` union, which mypy narrows on `e["type"] == "referral.qualified"`.
- Use `webhooks.verify_any(body, header, [new_secret, old_secret])` while you rotate your own secrets.

## Async

```python
from clikgate import AsyncClikgate

clikgate = AsyncClikgate()
event = await clikgate.goals.send("account_opened", click_id=click_id, reference="APP-55231", value="2000000")
clikgate.goal("signup", reference=user.id)      # non-blocking; needs a running event loop
await clikgate.close()                          # in your lifespan shutdown
```

## Short-lived processes

In a serverless function, a Celery task or a management command, call `clikgate.flush()` before returning (`atexit` also flushes at a normal exit). Alternatively use `Clikgate(send_mode="sync")` with `clikgate.goals.send(…)`.

## Private mode

- With `private_mode="auto"` (the default), the SDK reads your organisation's setting from `GET /v1/server-sdk/config` and caches it for 10 minutes.
- When private mode is on, only `goal`, `click_id`, `code`, `reference`, `value`, `currency`, `is_first`, `occurred_at`, `provider` and `consent` are sent. Anything else (`metadata`, emails, customer IDs, …) is refused **before sending** with `PrivateModeFieldRejectedError`, which names the field, never its value.
- References are redacted in logs.
- If the setting can't be loaded, the SDK assumes private mode is on.

## Links

```python
link = clikgate.links.create(destination_url="https://example.com/spring", og_title="Spring sale", og_image_url="https://example.com/og.png")
result = clikgate.links.update(link["id"], destination_url="https://example.com/summer")
if not result["applied"]:
    print("waiting for a second person:", result["change_request"]["id"])
for link in clikgate.links.list(limit=100):
    print(link["short_url"])

# Filter by your own link metadata (sent as metadata[seller_id]=sel_ada); analytics take it too.
for link in clikgate.links.list(metadata={"seller_id": "sel_ada"}):
    print(link["metadata"]["seller_id"])
ada = clikgate.api.analytics.analytics_summary(var_from="2026-10-01T00:00:00Z", to="2026-11-01T00:00:00Z", metadata={"seller_id": "sel_ada"})
```

`links.create` and `links.update` also take a typed `LinkCreateParams` / `LinkUpdateParams` dict as the first argument (`clikgate.links.create({"destination_url": …})`). `links.archive(id)`, `links.pause(id)`, `links.resume(id)` and `links.get_by_reference("order-1001")` return the link.

A locked link raises `LinkLockedError`. `clikgate.api.<resource>.<operation>()` exposes every other API-key operation ("advanced"), generated from the OpenAPI document and sent through the same pipeline.

## Referrals

```python
referrer = clikgate.referrals.get_or_create_referrer(PROGRAM_ID, customer_id=str(user.id), display_name="Ada")
referrer["code"], referrer["url"], referrer["created"]          # created: True the first time
clikgate.referrals.find_referrer(PROGRAM_ID, code="ADA42")      # a Referrer, or None when there is none
for referral in clikgate.referrals.list(program_id=PROGRAM_ID, status="qualified"):
    print(referral["referee"]["customer_id"], referral.get("reward_snapshot"))
clikgate.referrals.complete_step(referral_id, goal="first_order", occurred_at=order.paid_at, value=Decimal("1500.50"), currency="NGN")
clikgate.referrals.qualify(referral_id, reason="Checked by support")   # or disqualify(...)
jobs = clikgate.referrals.import_referrers(PROGRAM_ID, [{"customer_id": "user-42", "external_code": "ADA-OLD"}])   # batches of 1000
clikgate.referrals.block_referrer(referrer["id"], reason="Fake installs")   # unblock_referrer, update_referrer(display_name=, attributes=)
```

- Results are typed dicts with the API's keys; your customer ID is `customer_user_id`, and the SDK adds the same value as `customer_id` on referrers and on a referral's `referrer` and `referee`. `list_page(...)` returns one page; `list(...)` iterates lazily (filters `program_id`, `referrer_id`, `referee_customer_id`, `status`, `from_`, `to`, `limit`).
- A reward side's `amount_minor` (minor units, as the API sends it) comes with `amount`, the same amount in normal units as a decimal string with the currency's decimals (`50000` NGN is `"500.00"`, `1500` JPY is `"1500"`). Clikgate never pays rewards.

## Privacy, people, installs and codes

```python
clikgate.privacy.create_request(type="erasure", subject_type="customer_user", subject_id=str(user.id))
clikgate.privacy.get_request("prq_01J…")                            # an export's result has its download link
clikgate.people.get("per_01J…"); clikgate.people.set_label("per_01J…", "Ada (VIP)")
for person in clikgate.people.search("Ada"):                          # the text goes in the body, never the URL
    print(person["id"], person.get("label"))
clikgate.installs.get_by_customer(str(user.id), app_id="app_01J…")    # or get_by_installation(installation_id, app_id=…)
redemption = clikgate.codes.redeem(external_id="POS-991", code="ADA42", channel="pos")
```

All of it is on `AsyncClikgate` too (`await`, `async for`).

## Errors

Every error extends `ClikgateError` (`code`, `http_status`, `request_id`, `param`, `type`, `raw`): `ConfigurationError`, `AuthenticationError`, `PermissionError`, `InvalidRequestError`, `PrivateModeFieldRejectedError`, `NotFoundError`, `ConflictError`, `LinkLockedError`, `IdempotencyError`, `RateLimitError` (`retry_after`), `ServerError`, `NetworkError`, `TimeoutError` and `SignatureVerificationError`. `PermissionError` and `TimeoutError` are Clikgate's own classes (import them from `clikgate`); they don't extend the built-ins of the same name.

Network errors, timeouts and HTTP 429, 500, 502, 503 and 504 are retried up to `max_retries` (3) with full-jitter backoff, honouring `Retry-After`. Each call sends a random `Idempotency-Key`, reused across its retries; the API ignores a second goal event with the same goal and reference, so a retry never double counts.

## Options

`Clikgate(api_key=None, *, base_url, timeout=10.0, max_retries=3, send_mode="background", private_mode="auto", click_id_param, logger, on_error, http_client, proxy, batch_size=100, flush_interval=1.0, max_queue_size=10_000, shutdown_hooks=True, clock, random)`.

- `logger` is `logging.getLogger("clikgate")` by default; warnings carry `extra={"clikgate_code": …}`.
- `proxy` takes an `http(s)://user:pass@host:port` URL, or `False` to ignore `HTTPS_PROXY`/`NO_PROXY`. `http_client` takes your own `httpx.Client` (mTLS, corporate CAs).
- An unknown option raises `ConfigurationError`.

Licence: MIT. Security: report vulnerabilities to support@clikgate.com; see the [trust centre](https://clikgate.com/trust).
