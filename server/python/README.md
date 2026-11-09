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

## Identify your users

Two ways to tell Clikgate which of your users is using the app. Full guide: https://clikgate.com/docs/identify-users. The customer ID is your own user ID from your database, never an email, phone number or ID number. Anonymous users don't need either path.

**Path A (default): identity token.** Create the identity secret in Apps › your app › Identity secret and store it as `CLIKGATE_IDENTITY_SECRET` on your server only. `create_identity_token(customer_id, app_id=None)` (also `clikgate.create_identity_token()`, with the `identity_secret` / `identity_secrets` options) signs a token with no network call; return it in the responses the app already calls, and the app passes it to the mobile SDK's `identifyUser()`. Tokens last 30 days by default and are never force-refreshed. Throws `ClikgateServerOnlyError` in browser or mobile Python builds (Pyodide, WASI, iOS, Android).

```python
from clikgate import create_identity_token
# sign-in and "current user" responses: one extra field
return {"user": user, "clikgate_identity_token": create_identity_token(str(user.id))}   # reads CLIKGATE_IDENTITY_SECRET
create_identity_token(str(user.id), app_id="app_…")                                    # several apps: CLIKGATE_IDENTITY_SECRETS
```

**Path B: installation ID, no secret or token.** The app reads `getInstallationId()` and includes it in its sign-in request; your server calls `identifyUser` with the app ID, installation ID and customer ID, after sign-in and at every signed-in app open. Clikgate accepts installations active in the last 7 days.

```python
# The app sends Clikgate.getInstallationId() with its sign-in request (None when tracking is off: skip)
if installation_id:
    clikgate.identify_user(app_id="app_…", installation_id=installation_id, customer_id=str(user.id))
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
from clikgate import webhooks, SignatureVerificationError

event = webhooks.verify(request.body, request.headers.get("Clikgate-Signature"), os.environ["CLIKGATE_WEBHOOK_SECRET"])
```

- Pass the **raw** body (`request.body` in Django, `request.get_data()` in Flask, `await request.body()` in Starlette).
- Deliveries are at-least-once: dedupe on `event["id"]`.
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

A locked link raises `LinkLockedError`. `clikgate.api.<resource>.<operation>()` exposes every other API-key operation ("advanced"), generated from the OpenAPI document and sent through the same pipeline.

## Errors

Every error extends `ClikgateError` (`code`, `http_status`, `request_id`, `param`, `type`, `raw`): `ConfigurationError`, `AuthenticationError`, `PermissionError`, `InvalidRequestError`, `PrivateModeFieldRejectedError`, `NotFoundError`, `ConflictError`, `LinkLockedError`, `IdempotencyError`, `RateLimitError` (`retry_after`), `ServerError`, `NetworkError`, `TimeoutError` and `SignatureVerificationError`. `PermissionError` and `TimeoutError` are Clikgate's own classes (import them from `clikgate`); they don't extend the built-ins of the same name.

Network errors, timeouts and HTTP 429, 500, 502, 503 and 504 are retried up to `max_retries` (3) with full-jitter backoff, honouring `Retry-After`. Each call sends a random `Idempotency-Key`, reused across its retries; the API ignores a second goal event with the same goal and reference, so a retry never double counts.

## Options

`Clikgate(api_key=None, *, base_url, timeout=10.0, max_retries=3, send_mode="background", private_mode="auto", click_id_param, logger, on_error, http_client, proxy, batch_size=100, flush_interval=1.0, max_queue_size=10_000, shutdown_hooks=True, clock, random)`.

- `logger` is `logging.getLogger("clikgate")` by default; warnings carry `extra={"clikgate_code": …}`.
- `proxy` takes an `http(s)://user:pass@host:port` URL, or `False` to ignore `HTTPS_PROXY`/`NO_PROXY`. `http_client` takes your own `httpx.Client` (mTLS, corporate CAs).
- An unknown option raises `ConfigurationError`.

Licence: MIT. Security: see [SECURITY.md](SECURITY.md).
