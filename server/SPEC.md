# Clikgate server SDKs: the shared contract

Version 1.0 (2026-10-26), with the change 12 additions of 2026-10-28 (section 23). This document is normative for `@clikgate/node`, `clikgate` (Python),
`clikgate/clikgate-php`, `com.clikgate:clikgate-java` and `Clikgate` (.NET). Node is the reference
implementation. When an SDK and this file disagree, the SDK is wrong. When this file and the
conformance cases (`conformance/cases/*.json`) disagree, fix one of them in the same change.

The words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

Contents:

1. [Packages and runtimes](#1-packages-and-runtimes)
2. [Naming per language](#2-naming-per-language)
3. [Client options](#3-client-options)
4. [Requests: headers, User-Agent, bodies](#4-requests-headers-user-agent-bodies)
5. [Errors](#5-errors)
6. [Retries and backoff](#6-retries-and-backoff)
7. [Idempotency keys](#7-idempotency-keys)
8. [Money](#8-money)
9. [Goals and sending modes](#9-goals-and-sending-modes)
10. [Conversions (older API)](#10-conversions-older-api)
11. [Links, clicks and pagination](#11-links-clicks-and-pagination)
12. [Server SDK config and the private-mode guard](#12-server-sdk-config-and-the-private-mode-guard)
13. [Click IDs](#13-click-ids)
14. [Webhook verification](#14-webhook-verification)
15. [Logging and warnings](#15-logging-and-warnings)
16. [Generated API layer](#16-generated-api-layer)
17. [Framework add-ons](#17-framework-add-ons)
18. [Test seams (for the conformance runner)](#18-test-seams-for-the-conformance-runner)
19. [Quality bar, versioning and release](#19-quality-bar-versioning-and-release)
20. [Backend facts this contract relies on](#20-backend-facts-this-contract-relies-on)
21. [Metadata filters and link metadata (change 10)](#21-metadata-filters-and-link-metadata-change-10)
22. [Payments confirmed by the business's server (change 11, route D)](#22-payments-confirmed-by-the-businesss-server-change-11-route-d)
23. [Goal kinds, goal status and the shared enums (change 12)](#23-goal-kinds-goal-status-and-the-shared-enums-change-12)
24. [People: `identifyUser` and goal labels (change 14)](#24-people-identifyuser-and-goal-labels-change-14)
25. [Hashed email and phone for ad network matching (change 19)](#25-hashed-email-and-phone-for-ad-network-matching-change-19)

---

## 1. Packages and runtimes

| Language | Package | Directory | Minimum runtime | `sdk` token (User-Agent) | Runtime token |
|---|---|---|---|---|---|
| Node.js / TypeScript | `@clikgate/node` | `server/node/` | Node 18 | `node` | `node` |
| Python | `clikgate` | `server/python/` | Python 3.9 | `python` | `python` |
| PHP | `clikgate/clikgate-php` (+ `clikgate/clikgate-laravel`) | `server/php/`, `server/php-laravel/` | PHP 8.1 | `php` | `php` |
| Java / Kotlin | `com.clikgate:clikgate-java` (+ `clikgate-spring-boot-starter`) | `server/java/`, `server/java-spring-boot-starter/` | Java 8 (bytecode 52) | `java` | `java` |
| C# / .NET | `Clikgate` (+ `Clikgate.AspNetCore`) | `server/dotnet/` | .NET Standard 2.0 and .NET 8 | `dotnet` | `dotnet` |

- Licence: MIT, everywhere.
- Runtime dependencies (S.13):
  - Node: none.
  - Python: `httpx` only.
  - PHP: PSR interfaces + `php-http/discovery`.
  - Java: Jackson databind only (declared, not shaded).
  - .NET: none on .NET 8; `System.Text.Json` on .NET Standard 2.0.
- One client per process. Clients MUST be safe to share between threads, requests and async tasks. The docs say "create one client and reuse it".

## 2. Naming per language

The contract below uses **canonical names**: `snake_case` for options, arguments and wire fields, and
dotted method paths (`goals.send`). Each SDK maps them with its language's convention:

| Canonical | Node / TypeScript | Python | PHP | Java | .NET |
|---|---|---|---|---|---|
| option `api_key` | `apiKey` | `api_key` | `apiKey` | `apiKey(...)` builder | `ApiKey` |
| method `goals.send` | `goals.send()` | `goals.send()` | `goals->send()` | `goals().send()` | `Goals.SendAsync()` |
| method `goals.send_batch` | `goals.sendBatch()` | `goals.send_batch()` | `goals->sendBatch()` | `goals().sendBatch()` | `Goals.SendBatchAsync()` |
| method `goal` | `goal()` | `goal()` | `goal()` | `goal()` | `Goal()` (enqueues, sync) / `GoalAsync()` (sync mode) |
| error `RateLimitError` | `RateLimitError` | `RateLimitError` | `RateLimitException` | `RateLimitException` | `RateLimitException` |
| enum member `GoalKind.payment` (section 23) | `GoalKind.Payment` | `GoalKind.PAYMENT` | `GoalKind::Payment` | `GoalKind.PAYMENT` | `GoalKind.PAYMENT` |

- **Error classes:**
  - Node and Python keep the `…Error` suffix.
  - PHP, Java and .NET use `…Exception`.
  - Java and .NET rename the two that clash with platform types: `ClikgateTimeoutException` and `ClikgateNetworkException`. PHP does the same for symmetry.
  - Conformance runners report the **canonical** (Node) name; see the table in section 5.
- **Results:**
  - Results are the wire objects. Node and Python return the JSON with its `snake_case` keys (typed as interfaces or TypedDicts).
  - Java, .NET and PHP MAY return typed models. Their conformance runner serialises them back to the wire JSON.
- **Options:** argument objects use the language's case (`clickId` in Node, `click_id` in Python). SDKs convert to `snake_case` on the wire.

## 3. Client options

| Option | Default | Rules |
|---|---|---|
| `api_key` | env `CLIKGATE_API_KEY` | MUST start with `cg_live_` or `cg_test_`. The mode (`live`/`test`) comes from the prefix and is exposed as `client.mode`. Missing, or another key type (`cg_sdk_*` mobile keys, `cg_site_*` web keys, `cg_cli_*`): `ConfigurationError` at construction. The message names the key **type**, never the key. |
| `base_url` | env `CLIKGATE_BASE_URL`, else `https://api.clikgate.com` | Trailing `/` removed. MUST be `https://`, except `http://localhost`, `http://127.0.0.1` and `http://[::1]` (any port), which are allowed for local development and the conformance mock. Anything else: `ConfigurationError`. |
| `timeout` | 10 s (PHP 3 s) | Per attempt, covering connect, send and receive. The unit is the language's idiom: Node ms (`10_000`), Python seconds (`10.0`), PHP seconds, Java `Duration`, .NET `TimeSpan`. It MUST be > 0. |
| `max_retries` | 3 | 0–10. With 3 there are up to 4 attempts. |
| `send_mode` | `background` (Node, Python, Java, .NET); `sync` (PHP) | `background` \| `sync`; PHP adds `after_response`. See section 9. |
| `private_mode` | `auto` | `auto` \| `true` \| `false`. See section 12. |
| `click_id_param` | from config, else `cgid` | `^[A-Za-z0-9_]{1,32}$`, else `ConfigurationError`. |
| `logger` | the language's standard logger, warnings and above | Node: console-compatible (`warn`, `error`, optional `info` and `debug`). Python: `logging.getLogger("clikgate")`. PHP: PSR-3. Java: SLF4J if present, else `java.util.logging`. .NET: `ILogger`. |
| `on_error` | none | Called for failures that can't throw (background sends; `goal()` in every mode). Signature `(error, context)`, see 9.5. An exception thrown inside it is caught and logged. |
| `http_client` | built-in | Node: a `fetch`-compatible function. Python: an `httpx.Client` / `AsyncClient`. PHP: PSR-18. Java: a `Transport`. .NET: `HttpClient` / `IHttpClientFactory`. |
| `proxy` | system settings | An explicit `http://` or `https://` proxy URL for HTTPS CONNECT tunnelling, or `false` to ignore system settings. "System settings" means the language's usual source: env `HTTPS_PROXY` / `https_proxy` / `HTTP_PROXY` / `http_proxy` plus `NO_PROXY` for Node, Python and PHP; JVM `https.proxyHost`; the .NET default proxy. Credentials in the proxy URL are sent as `Proxy-Authorization: Basic …` and never logged. |
| `batch_size` | 100 | 1–500. Background batch size. |
| `flush_interval` | 1 s | Background timer. |
| `max_queue_size` | 10,000 | Background queue bound. |
| `shutdown_hooks` | `true` | Flush on process exit (section 9.4). `false` opts out. |

- **Unknown options:** typed languages reject them at compile time. Python and PHP raise `ConfigurationError` for an unknown option name.
- **Configuration errors** are thrown at construction, never later.

## 4. Requests: headers, User-Agent, bodies

Every request carries these headers:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <api_key>` |
| `User-Agent` | see below |
| `Accept` | `application/json` |
| `Content-Type` | `application/json` (only when there is a body) |
| `Idempotency-Key` | on POST and PATCH only (section 7) |

- **User-Agent** (backend B.6 parses it; nothing else is sent, no telemetry):

  ```
  clikgate-<sdk>/<sdk version> (<runtime> <runtime version>; <os> <arch>)
  clikgate-node/1.0.0 (node 24.11.0; linux x64)
  clikgate-python/1.0.0 (python 3.12.4; windows x64)
  ```

  - `<runtime version>` has no leading `v`. For Java it is `java.version`; for .NET, `Environment.Version`.
  - **Sanitising (required by the backend parser, `src/server_sdk/utils/user_agent.py`):** `<sdk version>` and `<runtime version>` MUST match `^[0-9][0-9A-Za-z.+-]{0,39}$`. Replace any other character with `-` and truncate to 40 characters, so Java `1.8.0_402` becomes `1.8.0-402`. The backend keeps `sdk`, `sdk_version`, `runtime` and `runtime_version` (shown in Developers → SDKs and `GET /v1/developers/sdks`, with `latest_version`, `update_available` and `below_minimum`). A runtime version that fails the regex is silently stored as part of the runtime name.
  - The runtime token is the lowercase SDK token (`node`, `python`, `php`, `java`, `dotnet`), never `.NET` or `OpenJDK`.
  - `<os>` is lowercase: `linux`, `darwin`, `windows`, `freebsd`, … (Node `win32` becomes `windows`).
  - `<arch>` is normalised to `x64`, `arm64`, `x86` or `arm`. Anything else is passed through, lowercased, with spaces removed.
  - Regex the conformance judge enforces: `^clikgate-(node|python|php|java|dotnet)/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?) \(([a-z]+) ([0-9][0-9A-Za-z.+-]{0,39}); ([^ ]+) ([^)]+)\)( .*)?$`.
  - SDKs MAY append ` <framework>/<version>` after the closing parenthesis (for example ` express/5.3.0`), but only when the add-on knows it cheaply. The backend ignores anything after `)`.
- **JSON bodies:**
  - UTF-8.
  - **Unset optional fields are omitted, never sent as `null`.** An explicit `null` given by the caller in a raw `params` map (links, conversions, `api.*`) is sent as `null`, because PATCH uses it to clear a field.
  - Dates are sent as RFC 3339 UTC strings: `YYYY-MM-DDTHH:MM:SSZ`, with `.sss` only when the milliseconds are not zero. Strings given by the caller are passed through unchanged.
- **Paths:** path parameters are percent-encoded (RFC 3986 unreserved characters kept).
- **Query values:** booleans become `true`/`false`, `null`/unset are omitted, arrays repeat the key, and dates use the format above.
- **Responses:**
  - A `2xx` with a JSON body is parsed and returned.
  - A `2xx` with an empty body returns an empty result (`null`/`None`).
  - Binary endpoints (`links.qr`) return bytes and the content type.

## 5. Errors

Every error extends `ClikgateError`, which exposes `http_status` (int or null), `code` (string), `message`, `request_id` (string or null), `param` (string or null) and `type` (the envelope's type, or null for local errors). The raw error object is available as `body`/`raw` (Node `error.raw`).

The backend envelope (backend spec 6.2), from `src/core/errors.py`:

```json
{"error": {"type": "invalid_request", "code": "invalid_value", "message": "…", "param": "value", "request_id": "req_…"}}
```

- `type` is one of `invalid_request`, `authentication`, `permission`, `not_found`, `conflict`, `rate_limited`, `idempotency` or `server`.
- Extra keys (`details`, `required_plan`, …) MAY be present and are kept in `raw`.
- `request_id` comes from the body, else from the `X-Request-Id` response header.

**Mapping.** Evaluate the rules top to bottom. The first rule that matches wins.

| # | Condition | Class (canonical) | `code` |
|---|---|---|---|
| 1 | could not connect / connection reset / DNS / TLS failure | `NetworkError` | `network_error` |
| 2 | the per-attempt timeout elapsed | `TimeoutError` | `timeout` |
| 3 | status 429 | `RateLimitError` (`retry_after`: seconds from `Retry-After`, else null) | body code, else `rate_limit_exceeded` |
| 4 | status ≥ 500 | `ServerError` | body code, else `http_<status>` |
| 5 | body `error.code` = `private_mode_field_rejected` | `PrivateModeFieldRejectedError` (`field` = `param`) | `private_mode_field_rejected` |
| 6 | status 401 | `AuthenticationError` | body code |
| 7 | status 403 | `PermissionError` | body code |
| 8 | status 404 | `NotFoundError` | body code |
| 9 | status 409 and (`type` = `idempotency` or code starts with `idempotency_`) | `IdempotencyError` | body code |
| 10 | status 409 and code = `link_locked` | `LinkLockedError` (extends `ConflictError`) | `link_locked` |
| 11 | status 409 | `ConflictError` | body code |
| 12 | any other status ≥ 400 (400, 410, 422, 428, …) | `InvalidRequestError` | body code, else `http_<status>` |
| 13 | status 1xx/3xx (redirects are never followed) | `ServerError` | `unexpected_status` |

- When an error body isn't JSON, or has no `error` object (a proxy's HTML 502, for example), the class still follows the status. `code` is then `http_<status>`, and `message` is `"HTTP <status>"` plus at most the first 200 characters of the body, with control characters stripped.
- **A goal refusal body** (change 23 R.1): a response with no `error` object whose body is a JSON object with `status: "refused"` and a non-empty string `reason` (`422 {"status": "refused", "reason": "unknown_goal", "counted": false, "goal_kind": null}`) takes `code` = that `reason`. The body is the `raw` object; `param` and `type` are null; `message` follows the rule above. The class still follows the status.

**Hierarchy:**

```
ClikgateError
├── ConfigurationError            (construction; code missing_api_key | invalid_api_key | invalid_option)
├── AuthenticationError           (401)
├── PermissionError               (403)
├── InvalidRequestError           (400/410/422/…, and local validation: http_status null)
│   └── PrivateModeFieldRejectedError   (local guard or server 422; `field`)
├── NotFoundError                 (404)
├── ConflictError                 (409)
│   └── LinkLockedError
├── IdempotencyError              (409 idempotency_*)
├── RateLimitError                (429; retry_after)
├── ServerError                   (5xx, unexpected status)
├── NetworkError
├── TimeoutError
└── SignatureVerificationError    (webhooks; code below)
```

- **Known codes with extra fields.** These come from the backend (checked 2026-10-26). SDKs MUST expose the extra fields as typed properties, and `null` when absent:

  | Code | Status → class | Extra fields (wire → Node) | Source |
  |---|---|---|---|
  | `test_destination_not_allowed` | 422 → `InvalidRequestError` | `allowed` (list: `clikgate_test_page`, `verified_site`, `local_address`, `verified_tunnel`) → `allowed`; `doc_url` → `docUrl` | `src/test_links/utils/destinations.py` |
  | `test_link_limit_reached` | 403 → `PermissionError` | `limit` → `limit` | `src/test_links/services/test_link_policy.py` |
  | `domain_mode_mismatch` | 422 → `InvalidRequestError` (param `domain`) | — | `src/domains/services/domain_service.py` |
  | `plan_limit_reached` | 403 → `PermissionError` (`param` = the allowance key) | `required_plan` → `requiredPlan` | `src/billing/utils/errors.py` |
  | `plan_upgrade_required`, `feature_disabled` | 403 → `PermissionError` | `required_plan` → `requiredPlan` | backend spec 6.2 (feature gates such as exports and summaries) |
  | `plan_feature_unavailable` | 403 → `PermissionError` | `required_plan` → `requiredPlan` (`starter`); `feature` (`payment_goals`) stays in `raw` | change 12: Payment goals, payment reports and `payments.confirm` need Starter or above (`src/payments/services/plan_gate.py`) |
  | `cli_scope` | 403 → `PermissionError` | — (a setup-command token was used; server SDKs need an API key) | `src/cli/utils/allowlist.py` |
  | `link_locked` | 409 → `LinkLockedError` (`param` = the first locked field) | — | `src/links/services/link_service.py` |
  | `https_required` | 422 → `InvalidRequestError` (`param` = the URL field) | — (the organisation allows only `https://` destinations; live links) | `src/links/services/link_service.py` |
  | `destination_not_allowlisted` | 422 → `InvalidRequestError` (`param` = the URL field) | — (the organisation requires its destination allowlist; live links) | `src/links/services/link_service.py` |
  | `private_mode_field_rejected` | 422 → `PrivateModeFieldRejectedError` | `param` → `field` | `src/private_mode` |
  | `unknown_provider` | 422 → `InvalidRequestError` (param `provider`) | — (a well-formed provider the API doesn't know) | change 12 B3 |
  | `value_required`, `invalid_value`, `code_not_supported` | 422 → `InvalidRequestError` (param `value` / `code`) | — (a Payment goal sent by the server needs a value above 0 and takes `click_id`, not `code`) | change 12 B2.2, `src/goals/services/goal_events.py` |
  | `payment_goal_needs_confirmation` | 422 → `InvalidRequestError` (param `provider` or `reference`) | `missing` (list) stays in `raw` | change 12 B2.2 / B2.5: a Payment goal without `provider` or `reference`, from any sender (also `goals.send` and `conversions.create`) |
  | `unknown_goal` | 422 → `InvalidRequestError` (param `goal`, or null for a refusal body) | `status`, `reason`, `counted`, `goal_kind` stay in `raw` | change 23 R.1: "Allow unknown goal names" is off and no goal (or alias) has this name. Final: never retried (section 23.2) |
  | `goal_archived` | 422 → `InvalidRequestError` | — | change 23 R.1: the goal is archived and "Allow unknown goal names" is off (with the setting on it is a `received` result, never `410`) |

  Node also exports the `KnownErrorCode` union of these codes, plus every local code in this section.
- `PrivateModeFieldRejectedError` exposes `field`, the field **name** only. Its message MUST NOT contain the rejected value, and SDKs MUST NOT log the value either.
- **Local validation** throws `InvalidRequestError` with `http_status` null. Codes:
  - `invalid_goal_key`: the key doesn't match `^[a-z][a-z0-9_]{1,39}$`.
  - `invalid_reference`: missing, empty, or more than 128 characters.
  - `invalid_value`: section 8.
  - `click_id_and_code`: both were given.
  - `batch_too_large`: more than 500 events.
  - `batch_empty`: no events.
  - `invalid_argument`: a required argument such as an id is empty.
  - `invalid_provider`: a `provider` (goals, section 9.1; `payments.confirm`, section 22.2) that isn't a provider key, `^[a-z][a-z0-9_]{1,29}$`.

  These use the **same codes as the backend**, so handling code works whether the check ran locally or on the server.
- **Who throws:**
  - Sync calls (`goals.send`, `links.*`, `api.*`, …) throw.
  - `goal()` **never throws**, in any mode. Its failures go to `logger` (`error` level) and `on_error`.
  - Constructors throw `ConfigurationError`.
- **Canonical class names for conformance:** `ClikgateError`, `ConfigurationError`, `AuthenticationError`, `PermissionError`, `InvalidRequestError`, `PrivateModeFieldRejectedError`, `NotFoundError`, `ConflictError`, `LinkLockedError`, `IdempotencyError`, `RateLimitError`, `ServerError`, `NetworkError`, `TimeoutError`, `SignatureVerificationError`.

## 6. Retries and backoff

- **Retryable:**
  - `NetworkError`.
  - `TimeoutError`.
  - HTTP `429`, `500`, `502`, `503` and `504`.
  - **Nothing else.** That includes no other 4xx, `409 idempotency_request_in_progress` and `501`.
- **Attempts:** at most `1 + max_retries`. Every retry of one logical call reuses the **same** `Idempotency-Key` and the same body bytes.
- **Delay before retry `n`** (n = 0 for the first retry):
  - Backoff is **full jitter**: `delay_ms = floor(random() * min(20000, 500 * 2^n))`, with `random()` in `[0, 1)`. With `random() = 0.5` the delays are 250, 500, 1000, 2000, 4000, 8000, 10000, 10000, …
  - If a 429 or 503 response carries **`Retry-After`** (delta-seconds, or an HTTP-date measured against the SDK clock), `delay_ms = retry_after_seconds * 1000` exactly, with no jitter. If that is **more than 60 s**, the SDK does not retry and throws the `RateLimitError`/`ServerError` at once (with `retry_after`). An unparseable `Retry-After` is ignored, and backoff is used instead.
- **Exhaustion:** when retries are used up, the error of the **last** attempt is thrown.
- **Sleeping:** sleeping MUST use the injectable sleep (section 18). Async SDKs MUST NOT block a thread.
- **No retry for the config request:** `GET /v1/server-sdk/config` is a single attempt (section 12).

## 7. Idempotency keys

| Call | `Idempotency-Key` |
|---|---|
| `goals.send`, and each single goal sent by `goal()` in sync mode | a random UUID v4 per call, reused across its retries (change 09 X.E15: never a hash of the reference) |
| `goals.send_batch` and background batches | a random UUID v4 per batch request, reused across its retries |
| `goals.reverse`, `conversions.*`, `links.create`, `links.update`, every other POST/PATCH (including `api.*`) | a random UUID v4 per logical call, reused across its retries |
| GET, DELETE | none |

- Every POST/PATCH method takes an optional `idempotency_key` request option, which overrides the default.
- **Why goal keys are random (since 1.1.0, change 09 X.E15):** the backend dedupes goal events by `(organization, goal, reference_hash)` itself (X.E1), in every mode, so a resend after a crash, with a new key, returns `200` with the stored event and is never counted twice. A Payment goal sent by the server (section 23) is deduplicated by `(provider, reference)` the same way. The key only makes the retries of one call safe. Versions before 1.1.0 (never released) sent `sha256_hex(goal + ":" + reference)`; no SDK computes that key any more.
- **Same goal and reference, different body:** the backend returns the stored event (`200`); a goal can't be "corrected" by resending. Use `goals.reverse`. Batch items say the same with `status: 200` on the item.
- **Reversals use random keys** because two identical partial refunds are legitimate.
- **Backend behaviour** (`src/core/idempotency/idempotent_route.py`):
  - The same key with the same request replays the stored response, with `Idempotent-Replayed: true`.
  - The same key with a different request is `409 idempotency_key_reused` (`IdempotencyError`, not retried).
  - 4xx answers are stored too, so a retry gets the same answer; 5xx responses are not stored.
  - While the first request still runs, the backend answers `409 idempotency_request_in_progress`. That is not retried; for goals it is safe to resend later.

## 8. Money

`value` is always in **normal units** (₦2,000,000 is `2000000`, never kobo) and is always sent on the wire as a **JSON string** holding a plain decimal: `"2000000"`, `"1500.50"`.

**Accepted input types:**

| Language | Accepted | Refused |
|---|---|---|
| Node | `string`, `number`, `bigint` | anything else: `InvalidRequestError invalid_value` |
| Python | `Decimal`, `int`, `str` | `float`: `TypeError`; `bool`: `TypeError` |
| PHP | `string`, `int` | `float`: `InvalidArgumentException` under `declare(strict_types=1)`, otherwise an `inexact_number` warning and conversion as Node does |
| Java | `BigDecimal`, `long` (and `int`) | `double` / `float` overloads do not exist |
| .NET | `decimal` | `double` / `float` overloads do not exist |

**Conversion to the wire string:**

- **String:**
  - Leading and trailing whitespace is trimmed.
  - It MUST match `^[0-9]+(\.[0-9]+)?$`, otherwise `InvalidRequestError invalid_value`. Signs, exponents, thousands separators and a lone `.` are all refused.
  - It is sent as given after trimming. Trailing zeros (`"1500.50"`) and leading zeros are kept, and the server validates digits and the currency exponent.
- **Integer** (`int`, `long`, `bigint`, a safe-integer `number`): sent as its base-10 digits. A negative value raises `invalid_value`.
- **Decimal** (Python `Decimal`, Java `BigDecimal`, .NET `decimal`): sent in plain notation, never exponent notation. Python uses `format(d, "f")`, Java `toPlainString()`, and .NET `ToString(CultureInfo.InvariantCulture)`. The scale is kept, so `Decimal("1500.50")` becomes `"1500.50"`. Negative values, NaN and infinity raise `invalid_value`.
- **Node `number`:**
  - NaN, ±Infinity and negative numbers raise `invalid_value`.
  - A safe integer (`Number.isSafeInteger`) is sent as `String(n)`.
  - An integer above `2^53 - 1` is sent as `BigInt(n).toString()` with an `inexact_number` warning.
  - A non-integer is sent as the shortest round-trip decimal (`String(n)`; when that uses exponent notation, plain notation via `toFixed(20)` with the trailing zeros stripped), and an **`inexact_number` warning** is logged once per call: "pass a decimal string, like '1500.50', for exact values".
- **Absent value:** a `null`/absent value is omitted from the body.
- **Formatter:** each SDK exposes the formatter publicly as `format_value(value) -> string` (Node `formatValue`) so applications and the conformance runner can use it.

**Responses:** they carry `value` as a decimal string (or `null`), and from change 09 (X.E10) also `value_minor` (and `reversed_value_minor`), the same amount as an integer in the currency's minor units (or `null`). SDKs MUST NOT convert `value` to a float, and pass both fields through. Node and Python return the string. Java and .NET MAY expose `BigDecimal` / `decimal` getters next to the raw string.

## 9. Goals and sending modes

### 9.1 Goal options

| Canonical (wire) | Node | Type | Notes |
|---|---|---|---|
| `goal` | first argument `key` | string | `^[a-z][a-z0-9_]{1,39}$` |
| `reference` | `reference` | string, 1–128 | **required** |
| `click_id` | `clickId` | string | |
| `code` | `code` | string | offline or creator code; not together with `click_id` |
| `value` | `value` | money (section 8) | |
| `currency` | `currency` | ISO 4217 string | only sent when given |
| `provider` | `provider` | `Provider` (section 23) or a provider-key string | change 12: the gateway of a payment; `^[a-z][a-z0-9_]{1,29}$` locally (`invalid_provider`), the API checks the value (`422 unknown_provider`). A string lets you name a gateway added after your SDK release |
| `is_first` | `isFirst` | boolean | |
| `occurred_at` | `occurredAt` | datetime or RFC 3339 string | |
| `metadata` | `metadata` | object ≤ 8 KB | refused in private mode |
| `kept_by` | `keptBy` | `server_cookie\|script_cookie\|form\|payment_metadata\|unknown` | change 16: how the click ID was kept (`click_ids.context`, 13.1); unknown values are a local `invalid_request` |
| `browser_engine` | `browserEngine` | `webkit_ios\|safari_mac\|chromium\|gecko\|other` | change 16, from `click_ids.context` |
| `platform` | `platform` | `ios\|android\|macos\|windows\|linux\|other` | change 16, from `click_ids.context` |
| `consent` | `consent` | object | the four-purpose consent object; allowed in private mode (no identity in it) |
| `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` | `hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits` | 64 lowercase hex | change 19: your own SHA-256 hashes for ad network matching (section 25); `hash_for_ads` makes them; other values are a local `invalid_hashed_identifier` |
| (any) | `extra` | map | additional wire fields, merged last, for forward compatibility; subject to the private-mode guard |

- **Order of checks before anything is sent:**
  1. Local validation (section 5), including money formatting (section 8).
  2. Config-based warnings (section 12.3).
  3. The private-mode guard (section 12).

  In background mode step 1 runs inside `goal()`, and steps 2 and 3 run in the sender (9.3).

### 9.2 Methods

| Canonical | HTTP | Returns |
|---|---|---|
| `goal(key, options)` | depends on `send_mode` | nothing (void); never throws |
| `goals.send(key, options)` | `POST /v1/goals/events` | the `goal_event` object: `status` (`GoalStatus`: `counted`, `waiting`, `refused`), `reason`, `goal_kind`, `counted`, `value_ignored`, `event_status`, `attributed_to`, `first_for_click`, `payment`, … (section 23). Status `201` (new) and `200` (already received) both succeed; `waiting` and `refused` are results, not errors |
| `goals.send_batch(events)` | `POST /v1/goals/events/batch` with `{"events": [...]}` | the response `{"object": "list", "data": [{index, ok, status, goal_event \| error}]}`; per-item failures are **not** thrown |
| `goals.reverse(key, reference, {value?, reason?})` | `POST /v1/goals/events/reverse` with `{goal, reference, value?, reason?}` | the `goal_event` |
| `flush(timeout = 10 s)` | | waits until everything queued **or in flight** at call time has been attempted (sent, failed or re-queued); returns whether it finished before the timeout. Never throws |
| `close(timeout = 10 s)` | | stops timers and hooks, then flushes. Later `goal()` calls are refused with an `InvalidRequestError client_closed` passed to `on_error` |

- **Batch events** use the same options as `goals.send`, with the key in a `goal` field (Node: `{ goal: 'order_paid', reference, … }`).
- **Batch checks:** each event is validated and guarded before the request. The first failing event throws (with `index` set on the error), and nothing is sent.

### 9.3 Sending modes

- **`background`** (default in Node, Python, Java and .NET):
  - **Enqueueing:** `goal()` validates, then appends the event to an in-memory FIFO queue, and returns.
  - **When the queue is full** (`max_queue_size`), the **oldest** event is dropped. The SDK warns `queue_full_dropped`, and `on_error` gets `InvalidRequestError queue_full` for the dropped event.
  - **The sender** sends `POST /v1/goals/events/batch` when the queue reaches `batch_size`, when the `flush_interval` timer fires, on `flush()` and on shutdown. **At most one batch request is in flight per client**, so requests leave in queue order.
  - **The guard and config checks** (section 12) run in the sender, **before** each batch is built, so `privateMode: auto` can fetch config without blocking `goal()`. An event refused by the guard is dropped and passed to `on_error`; the rest of the batch goes on.
  - **Batch results:**
    - Items with `ok: false` go to `on_error`, mapped through section 5 using the item's `status` and `error`.
    - Items are never retried on their own.
    - `200` duplicates are success.
  - **Whole-batch failure after the retries in section 6:**
    - Retryable failures (network, timeout, 429, 5xx): the events are **re-queued at the front** and tried again on the next timer or flush. Each event counts its failed rounds; after **3 failed rounds** it is dropped and passed to `on_error`.
    - Non-retryable failures (401, 403, 400/422 for the whole request): the events are dropped and passed to `on_error` at once.
  - **Timers** MUST NOT keep the process alive (Node `unref()`, daemon threads, …).
- **`sync`:** `goal()` sends one `POST /v1/goals/events` per call, with a random key reused across that call's retries. Node and Python start the request without waiting (the promise or task is tracked, so `flush()` waits for it). PHP blocks. Failures go to `on_error`; `goal()` still never throws.
- **PHP `after_response`:** events are collected and sent after `fastcgi_finish_request()` when it exists, else at shutdown (`register_shutdown_function`). Laravel MAY send through a queued job (`CLIKGATE_QUEUE=redis`).
- **Serverless:** the docs say to `await clikgate.flush()` before returning, or to use `send_mode: sync` with `goals.send`.

### 9.4 Shutdown hooks (`shutdown_hooks: true`)

| Language | Hook |
|---|---|
| Node | `process.on('beforeExit')` (flush when the queue isn't empty), and `SIGTERM`/`SIGINT`. On a signal: flush with a 5 s timeout, remove the SDK's listener, and if no other listener remains, re-raise the signal (`process.kill(process.pid, signal)`) so the default exit still happens. One process-wide registry for all clients, so no `MaxListeners` warnings |
| Python | `atexit` |
| Java | `Runtime.addShutdownHook`; Spring `SmartLifecycle` / `DisposableBean` |
| .NET | `IHostedService.StopAsync` with ASP.NET Core; `DisposeAsync` / `Dispose` |
| PHP | `register_shutdown_function` (for `after_response`) |

### 9.5 `on_error(error, context)`

- **`context` fields:**
  - `operation` is `goal`, `goals.batch` or `config`.
  - `events` is a list of `{goal, reference}`. In private mode the reference is replaced by `"[redacted]"`.
  - `dropped` is a boolean.
- **The callback MUST NOT** receive event values, metadata or consent.

## 10. Conversions (older API)

| Canonical | HTTP |
|---|---|
| `conversions.create(params)` | `POST /v1/conversions` (`params`: wire fields, e.g. `external_id`, `click_id`, `type`, `amount_minor`, `value`, `currency`, `goal`, `metadata`, …) |
| `conversions.reverse(id, params?)` | `POST /v1/conversions/{id}/reverse` (`amount_minor?`, `reason?`, `external_id?`) |

- **Money:** a `value` in `params` is formatted by section 8.
- **The private-mode guard** applies (section 12). Its allow-list for conversions also contains `external_id`.
- **Payment goals (change 12, backend C12 B2.5):** with `goal` set to a Payment goal, `conversions.create` is the same
  call as a server Payment goal (section 23): `provider` (a `Provider`, also accepted in `params`) and the payment
  reference (`external_id` or `reference`) are required. The answer is then the **goal event** (`object:
  "goal_event"`) instead of the conversion: the result is `Conversion | GoalEvent`, told apart by `object` (Node and
  Python type it as the union; PHP returns the array; Java `Conversion.isGoalEvent()` / `asGoalEvent()`, .NET
  `Conversion.IsGoalEvent` / `AsGoalEvent()`). Enum values in `params` (`Provider.PAYSTACK`) are sent as their wire
  strings. Conformance `conversions.create.payment_goal*`.
- **Reversal guard:** for `conversions.reverse` and `goals.reverse` the allow-list is `goal`, `reference`, `value`, `external_id`, `amount_minor`. So `reason` (free text) is refused in private mode, as the backend does.
- **`amount_minor` on `conversions.create`** is not on the allow-list, so it is refused in private mode, matching the backend (send `value` instead).

## 11. Links, clicks and pagination

| Canonical | HTTP | Returns |
|---|---|---|
| `links.create(params)` | `POST /v1/links` | the `link` (includes `warnings: [{code, message, param?}]`, e.g. `no_preview`) |
| `links.get(id)` | `GET /v1/links/{id}` | the `link` |
| `links.update(id, params)` | `PATCH /v1/links/{id}` | a **`LinkUpdateResult`** (below) |
| `links.list(params?)` | `GET /v1/links` | an auto-paginating iterator of `link` objects |
| `links.list_page(params?)` | `GET /v1/links` | one page `{object: "list", data, has_more, next_cursor}` |
| `links.qr(id, {format?, size?, margin?, dark?, light?})` | `GET /v1/links/{id}/qr` | `{content_type, data (bytes)}` |
| `clicks.get(click_id)` | `GET /v1/clicks/{id}` | the `click` |

- **Link fields the SDK relies on:**
  - `warnings[]`.
  - `domain_badge`: `"premium"` on `ciz.to` links, else `null` (`src/links/schemas/response/link_info_response.py`).
  - `locked`, `locked_by`, `locked_at` (B.10). Locking is `POST /v1/links/{id}/lock` (`links:write`, generated `api.links.*`); unlocking needs `org:manage`.
- **Test links** (test-mode keys only; backend B.8):
  - The destination may be a full URL or the shorthand `clikgate-test:<inspect|checkout|app-open|store>`. The SDK sends it unchanged and never validates destinations locally.
  - The domain is always `dev.ciz.to`. A live domain gives `422 domain_mode_mismatch`.
  - `expires_at` is capped by the server at 30 days after creation. The SDK sends what the caller gives and returns what the server stores.
  - The errors are in the table in section 5.
- **`LinkUpdateResult`:**

  ```json
  {"applied": true,  "link": { … }, "change_request": null, "warnings": [ … ]}
  {"applied": false, "link": null,  "change_request": { … }, "warnings": []}
  ```

  - `200`: `applied: true`, `link` is the body, and `warnings` is `link.warnings` (or `[]`).
  - `202` (two-person approval, backend B.10): `applied: false`, and `change_request` is the body:

    ```json
    {"object": "link_change_request", "id": "lcr_…", "link_id": "lnk_…", "status": "pending", "from_url": "https://old", "to_url": "https://new",
     "requested_by": "…", "requested_by_type": "api_key", "decided_by": null, "decided_at": null, "decision_note": null,
     "expires_at": "…", "created_at": "…", "livemode": true}
    ```

    This is the backend's `LinkChangeRequestInfoResponse`. `status` is `pending`, `approved`, `rejected` or `expired`. Approving or rejecting needs a dashboard user (`403 approval_requires_user` for API keys; the generated `api.linkChangeRequests.*` calls exist but answer that for keys).

  - `409 link_locked`: throws `LinkLockedError`, which is never retried. Unlocking needs `org:manage` in the dashboard.
- **Pagination:**
  - The backend uses cursors (`src/core/pagination.py`): `limit` (1–100, default 25), `starting_after`, `ending_before`. The response has `has_more` and `next_cursor`.
  - The iterator requests the next page with `starting_after = next_cursor` and keeps the caller's other params.
  - It stops when `has_more` is false or `next_cursor` is null.
  - Pages are fetched lazily, one request at a time.
  - Node: `for await (const link of clikgate.links.list({ limit: 100 }))`. Python: `for link in clikgate.links.list()`. Java: `Iterable<Link>`. .NET: `IAsyncEnumerable<Link>`.

## 12. Server SDK config and the private-mode guard

### 12.1 Config

`GET /v1/server-sdk/config` (backend B.5; any valid API key):

```json
{"mode": "live", "organization_id": "org_…", "private_mode": false, "click_id_param": "cgid",
 "goals": [{"key": "account_opened", "value_mode": "optional", "default_currency": "NGN"}],
 "minimum_sdk_versions": {"node": "1.0.0", "python": "1.0.0", "php": "1.0.0", "java": "1.0.0", "dotnet": "1.0.0"}}
```

- **When it is fetched:** only when `private_mode` is `auto`, lazily, before the first goal, goal batch, reversal or conversion is sent, or when the application calls `config()` (Node `clikgate.config()`).
- **Caching:** it is cached for **10 minutes** from the SDK clock. Concurrent callers share one in-flight request.
- **Single attempt:** no retries, with a timeout of `min(timeout, 5 s)`.
- **Failure** (network, timeout, any non-2xx including 404 from an older backend, or an unparseable body):
  - The guard is **on** (fail closed).
  - The SDK warns `config_unavailable` once per failure.
  - It tries again after **60 s** (negative cache).
  - The goal itself is still sent if it passes the guard.
- **What it is used for:**
  - The guard (12.2).
  - `click_id_param` (section 13), when the option isn't set.
  - Goal warnings (12.3).
  - The version check: if `minimum_sdk_versions.<sdk>` is greater than the SDK version (semver), the SDK warns `sdk_below_minimum_version` once per client.

### 12.2 The guard

The guard is **on** when `private_mode` is `true`, when it is `auto` and config says `"private_mode": true`, or when it is `auto` and config is unavailable. It is **off** when `private_mode` is `false` (the server still enforces).

When on, before the HTTP layer sees anything, the SDK checks every wire field of the payload whose value is not null:

| Payload | Allowed wire fields |
|---|---|
| goal event (`goals.send`, `goal()`, batch items) | `goal`, `click_id`, `code`, `reference`, `value`, `currency`, `is_first`, `occurred_at`, `consent` (the four-purpose consent object, change 09), `provider` (change 12), `kept_by`, `browser_engine`, `platform` (change 16, 13.1), `label` (change 14), `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` (change 19, section 25) |
| conversion (`conversions.create`) | the above + `external_id` |
| reversal (`goals.reverse`, `conversions.reverse`) | `goal`, `reference`, `value`, `external_id`, `amount_minor` |

- **Source of truth:** these lists match the backend's (`clikgate_api/src/private_mode/utils/private_mode.py`
  `GOAL_EVENT_FIELDS` and `CONVERSION_FIELDS`; `src/payments/services/confirmations.py` `PRIVATE_FIELDS` for
  confirmations), re-checked 2026-10-28. The reversal list is stricter than the backend's on purpose (free-text
  `reason` stays local).
- **A refused field** raises `PrivateModeFieldRejectedError` with `field` = the first refused wire field, in this order: `metadata`, `consent`, then the others in alphabetical order. Nothing is sent. For batches, the error has `index`.
- **`goal()`** passes the error to `on_error`.
- **References in logs:** while the guard is on, references are written as `[redacted]` in every SDK log line and `on_error` context.
- **Tests** MUST assert that nothing refused reaches the transport. The conformance cases check that no request is made.

### 12.3 Goal warnings (warn-only, `auto` mode with config loaded)

| Warning code | When |
|---|---|
| `unknown_goal` | the key isn't in `config.goals` |
| `value_not_allowed` | a value was given and the goal's `value_mode` is `none` |
| `value_required` | there is no value and `value_mode` is `required` |

- **Once only:** each (code, goal key) pair is warned once per client.
- **The event is still sent.** The server is the source of truth, and config can be up to 10 minutes old. With "Allow unknown goal names" off the server may then refuse it (`422 unknown_goal`, section 23.2): the warning never blocks, and the SDK never remembers the setting.

## 13. Click IDs

- **Valid ID:** `^clk_[0-9A-Z]{26}$` (prefixed ULID, Crockford base32, uppercase).
- **Parameter:** `param` is `click_id_param`, from the option, else the loaded config, else `cgid`.
- **Cookie name:** `_cg_<param>`, the same first-party cookie the web script writes (`src/static/clikgate.js`).

| Canonical | Behaviour |
|---|---|
| `click_ids.is_valid(id)` | regex test; non-strings are false |
| `click_ids.from_request(request)` | 1. the query parameter `param` (the first occurrence whose value is valid); 2. the cookie `_cg_<param>` (cookie value URL-decoded); 3. the header `Clikgate-Click-Id` (case-insensitive, trimmed). The first **valid** value wins; invalid values are skipped. Returns the ID or null |
| `click_ids.cookie_header(id, {days = 30, secure = true, domain?})` | the `Set-Cookie` value, attribute order exact: `_cg_<param>=<id>; Path=/; Max-Age=<days*86400>[; Domain=<domain>]; SameSite=Lax[; Secure]`. **Not** `HttpOnly`, because the web script reads it. An invalid ID raises `InvalidRequestError invalid_click_id` |
| `click_ids.persist(response, id, options)` | appends that header to the framework's response, **keeping** existing `Set-Cookie` headers, then (change 16) the marker `_cg_kept=s` with the same `Path`, `Max-Age`, `Domain`, `SameSite` and `Secure` (so the web script reports `kept_by: server_cookie`). If `secure` isn't given, it is true when the request is HTTPS (TLS socket, or `X-Forwarded-Proto: https`), and true when unknown |
| `click_ids.keep_route(options)` | change 16: the `/cg/keep` handler (13.1) |
| `click_ids.from_payment_metadata(payload)` | below |

**`from_payment_metadata(payload)`**, matching `src/sales/providers/normalize.py`:

1. If `payload` is a string, parse it as JSON. If that fails, return null.
2. Candidates, in order: `payload`, then `payload.data` (Paystack and Flutterwave webhook envelopes), when it is an object.
3. For each candidate, the containers in order are: the candidate itself, then `metadata`, `meta`, `meta_data`, `note_attributes`, `attributes`, `custom_attributes`, `customAttributes`.
   - An object container is used as is.
   - A string container is parsed as JSON.
   - A list container of `{name | key | variable_name | display_name, value}` items becomes a map.
4. In each container, check the keys `cg_click_id`, `cgid`, `clikgate_click_id` in that order. Then, if the container has a `custom_fields` list, check it the same way (Paystack).
5. The first value that is a string and `is_valid` wins. Otherwise return null.

**Framework neutrality:** `from_request` and `persist` accept the language's common request and response types. The conformance cases describe a request as `{url, headers}` and the runner builds the native object.

### 13.1 `/cg/keep` (change 16, R.1)

The web script's optional `data-server-endpoint="/cg/keep"` makes one `POST` to the business's **own** server (the
host that serves the page) when a click ID arrives in the page URL, so the server sets the cookie. Safari, and every
browser on iPhone, keeps a click ID saved by a script for up to 7 days (sometimes less). When your server saves it,
it lasts as long as you choose, up to the browser's limit.

`click_ids.keep_route({days = 30, secure = true, domain?})` returns the framework's handler (Node: a Fetch handler
`(Request) => Response` plus `.express` / `.node` adapters; Python: a WSGI/ASGI-neutral `handle_keep(method, headers,
body)` plus Django view / Flask view / Starlette endpoint; PHP: PSR-15 handler and a Laravel route macro; Java: a
servlet and a Spring controller in the starter; .NET: `app.MapClikgateKeep("/cg/keep")`). Every adapter calls one
core function that implements exactly:

1. **Method:** anything but `POST` → `405` with `Allow: POST`. The query string is never read.
2. **Same site:** `Sec-Fetch-Site` (case-insensitive name) present → it must be `same-origin`, else `403`. Absent →
   an `Origin` header must be present and equal `<scheme>://<host>` where host is the request's `Host` (or the first
   `X-Forwarded-Host` value), compared case-insensitively including the port; scheme `https` or `http`; otherwise
   (`null`, missing, other host or port) `403`.
3. **Body:** at most 1024 bytes of JSON object `{"click_id": "...", "page_click_id": "..."}` (other keys ignored).
   Not JSON, not an object, too large, either value not a string matching `^clk_[0-9A-Z]{26}$`, or the two not equal
   → `400`.
4. **Cookies:** the name is `_cg_<click_id_param>` from configuration (option, else loaded config, else `cgid`),
   **never** from the request. Two `Set-Cookie` headers in this order:
   `_cg_<param>=<id>; Path=/; Max-Age=<days*86400>[; Domain=<domain>]; SameSite=Lax[; Secure]` and
   `_cg_kept=s; Path=/; Max-Age=<days*86400>[; Domain=<domain>]; SameSite=Lax[; Secure]`. Not `HttpOnly` (the web
   script reads both). `secure` defaults to **true** here (not auto-detected).
5. **Response:** `204` with an empty body. Every response (204, 400, 403, 405) carries `Cache-Control: no-store,
   private`, an empty body, no `Location`; never a redirect; the input is never echoed or logged.

`days` must be 1–400 (browsers cap cookie lifetimes at 400 days); otherwise construction throws `InvalidRequestError
invalid_argument`. Conformance: `conformance/cases/click_ids.json`, ids `click_ids.keep.*`.

**Visitor context for goals (change 16, B.1/R.2):** goals the business's server sends MAY carry `kept_by`
(`server_cookie|script_cookie|form|payment_metadata|unknown`), `browser_engine`
(`webkit_ios|safari_mac|chromium|gecko|other`) and `platform` (`ios|android|macos|windows|linux|other`). The
`click_ids.context(request)` helper returns `{click_id, kept_by, browser_engine, platform}` for a goal's options:
`kept_by` is `server_cookie` when the click ID came from the cookie and the `_cg_kept=s` marker is present,
`script_cookie` when it came from the cookie without the marker, `form` when it came from a form field or the
`Clikgate-Click-Id` header, and absent otherwise; the engine and platform are parsed from the request's
`User-Agent` in the SDK (the User-Agent itself is never sent). These three fields are on the private-mode allow-list
(coarse, nothing personal).

| `User-Agent` contains (checked in order) | `browser_engine` |
|---|---|
| `iPhone`, `iPad` or `iPod` | `webkit_ios` (every iPhone browser, including `CriOS`, `FxiOS`, `EdgiOS`) |
| `Firefox/` | `gecko` |
| `Chrome/`, `Chromium/`, `Edg/`, `OPR/`, `SamsungBrowser/` | `chromium` |
| `Macintosh` and `Safari/` and `Version/` | `safari_mac` |
| anything else | `other` |

| `User-Agent` contains (in order) | `platform` |
|---|---|
| `iPhone`, `iPad`, `iPod` | `ios` |
| `Android` | `android` |
| `Macintosh` or `Mac OS X` | `macos` |
| `Windows` | `windows` |
| `Linux` or `X11` | `linux` |
| else | `other` |

## 14. Webhook verification

The header (backend spec 13.3, `docs/WEBHOOKS.md`, `src/core/webhook_signature.py`):

```
Clikgate-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>]
hex = lowercase hex HMAC-SHA256(key = UTF-8 bytes of the whole secret including "whsec_", message = "<t>." + raw body bytes)
```

| Canonical | Behaviour |
|---|---|
| `webhooks.verify(raw_body, signature_header, secret, {tolerance = 300, now?})` | returns the parsed event (`{id, object: "event", type, api_version, created_at, organization_id, livemode, data}`) or throws `SignatureVerificationError` |
| `webhooks.verify_any(raw_body, signature_header, secrets[], {tolerance = 300, now?})` | the same; succeeds if **any** secret matches any `v1` (used during your own secret rotation) |

**Algorithm:**

1. `raw_body` MUST be the exact bytes received: a string (encoded as UTF-8) or a byte buffer. A parsed object is refused with `invalid_payload`, because re-serialising changes the bytes.
2. If the header is missing or empty: `missing_signature`.
3. Split on `,`, trim each part, then split each part at the first `=`.
   - `t` is the timestamp: decimal digits only, else `malformed_signature`.
   - Every `v1` value is a candidate.
   - Other schemes (`v0`, …) are ignored.
   - No `t`, or no `v1`: `malformed_signature`.
4. If `tolerance > 0` and `|now - t| > tolerance`: `timestamp_outside_tolerance`. This applies in both directions. `now` defaults to the SDK clock in seconds.
5. Compute the expected hex for each secret. Compare it with each candidate using a **constant-time** comparison over equal-length values. A different length is a mismatch, not an error. No match: `no_matching_signature`.
6. Parse the body as JSON. If that fails, or it isn't an object: `invalid_payload`.

- **Error messages** never include the secret, the expected signature or the body.
- **No API key or client is needed.** Each SDK MUST offer verification without constructing a client (Node: `import { webhooks } from '@clikgate/node'`), as well as `client.webhooks`.
- `tolerance = 0` disables the time check. It is for tests only, and the docs say so.

## 15. Logging and warnings

- **Signature:** every warning is logged at `warn` level with a stable code, `logger.warn(message, {code, ...context})`. Python passes `extra={"clikgate_code": code}`; Java uses an SLF4J marker or MDC key `clikgate_code`; .NET uses an `EventId` name. Conformance runners capture the codes.
- **Warning codes:** `inexact_number`, `unknown_goal`, `value_not_allowed`, `value_required`, `config_unavailable`, `sdk_below_minimum_version`, `queue_full_dropped`.
- **Debug lines:** a goal refused with `unknown_goal` (section 23.2) logs ``Goal `{name}` isn't set up in Clikgate`` at **debug** level, code `unknown_goal`, so it shows only when debug logging is on: Node, a `logger` with a `debug` method; Python, the `clikgate` logger enabled for `DEBUG`; PHP, the PSR-3 logger's `debug()`; Java, SLF4J debug or java.util.logging `FINE` (`ClikgateLogger.debug`, a default method that does nothing, so existing loggers keep compiling); .NET, `ClikgateLogLevel.Debug`. The goal name only.
- **Errors** in background or `goal()` sends are logged at `error` level with the error's class, code and request ID, plus `on_error`.
- **Never logged:** API keys (at most the first 8 characters, `cg_live_` style, and only at debug level), webhook secrets, bodies, values, metadata, and (in private mode) references.
- **Default level:** warnings and above, so the defaults produce no info or debug output.

## 16. Generated API layer

- **Surface:** `client.api.<resource>.<operation>(…)` exposes every API-key operation in `openapi.json` (S.16). Resources come from the OpenAPI tag (`Ad Spend` becomes Node `adSpend`, Python `ad_spend`). Operations come from the summary (`List Links` becomes `listLinks` / `list_links`).
- **One code path:** generated code MUST call the SDK's own request function, so the transport, User-Agent, retries, idempotency keys, errors and logging are the hand-written ones. There is no second HTTP stack.
- **Scope:** the generator (`server/codegen/`) keeps the operations the backend marks `x-clikgate-auth: api_key`. It drops `dashboard_session`, `staff`, `public`, `sdk_key` and `cli` operations. The filter is shared by all languages, so every SDK exposes the same operations.
- **Status:** the hand-written areas (goals, conversions, links, clicks, click IDs, webhooks, the private-mode guard) are what the docs teach. `api.*` is "advanced".
- **Guard and goal keys:** the private-mode guard (section 12) and the goal key rules (section 7) belong to the hand-written goal and conversion methods. `api.goals.recordGoalEvent` sends what it is given (the server still enforces private mode). The docs point to `goals.send`.
- **Regeneration:** one command, `node server/codegen/generate.mjs`. CI fails on drift (`--check`).

## 17. Framework add-ons

Each add-on reads the click ID with `click_ids.from_request`. When the ID came from the **query string**, it also persists it with `click_ids.persist` ("last click wins", like the web script; option `persist`, default true). It exposes the ID:

| Framework | Usage | Exposes |
|---|---|---|
| Express / Connect | `app.use(clikgateMiddleware(clikgate))` from `@clikgate/node/express` | `req.clikgate.clickId` |
| Fastify | `fastify.register(clikgatePlugin, { client })` from `@clikgate/node/fastify` | `request.clikgate.clickId` |
| Next.js | `export { clikgateProxy as proxy } from '@clikgate/node/next'` (Next 16+, `proxy.ts`); `clikgateMiddleware` for the deprecated `middleware.ts`; `getClickId(await cookies())` | — |
| Django | `clikgate.django.ClikgateMiddleware` | `request.clikgate_click_id` |
| Flask | `Clikgate(app)` | `g.clikgate_click_id` |
| FastAPI / Starlette | `app.add_middleware(ClikgateMiddleware)`; `Depends(click_id)` | — |
| Laravel | auto-discovered provider, `clikgate` middleware alias, `Clikgate` facade, `config/clikgate.php` | `$request->clikgateClickId()` |
| PSR-15 | `ClikgateMiddleware` | attribute `clikgate.click_id` |
| Spring Boot | starter, `clikgate.*` properties, servlet filter | `@ClikgateClickId String clickId`, `ClikgateContext.currentClickId()` |
| Servlet | `ClikgateFilter` (`javax` and `jakarta` artifacts) | request attribute `clikgate.click_id` |
| ASP.NET Core | `builder.Services.AddClikgate(…)`; `app.UseClikgateClickId()` | `HttpContext.GetClikgateClickId()`, `IClikgateClient` via DI |

- **No hard dependency:** add-ons MUST NOT add runtime dependencies to the core package. Framework packages are optional peer dependencies or extras.
- **No blocking:** an add-on MAY start a background config load (in `auto` mode) so the organisation's `click_id_param` is known, but MUST NOT block the request on it.

## 18. Test seams (for the conformance runner)

Each SDK MUST let a test replace these, through a documented "advanced" option, not a private hack:

| Seam | Node option | Used for |
|---|---|---|
| clock `now()` (ms since epoch) | `clock.now` | config cache, `Retry-After` HTTP-dates, webhook `now` default |
| `sleep(ms)` | `clock.sleep` | retry delays (the runner records them and returns at once) |
| `random()` in `[0,1)` | `random` | backoff jitter |
| logger | `logger` | captures warning codes |

- **Timeouts** use real time, because the mock server delays its response.
- **`random` is only for backoff jitter.** Idempotency UUIDs MUST come from a cryptographic source, never the seam.

## 19. Quality bar, versioning and release

- **Typing:**
  - Node: TypeScript-first, ESM + CJS + `.d.ts`, strict.
  - Python: full hints, `py.typed`, mypy strict.
  - PHP: `strict_types`, PHPStan max.
  - Java: nullability annotations, Kotlin-friendly.
  - .NET: nullable reference types, async-first.
- **Docs in code:** doc comments with an example on every public method.
- **Tests:**
  - Unit tests.
  - The **conformance suite** (all cases pass, section 18).
  - A capturing-transport test for the guard.
  - Nightly live contract tests with a `cg_test_` key (C6-S6).
- **CI matrix:** every supported runtime plus the minimum, on Linux and Windows.
- **Releases:**
  - Tags `server-<lang>-v<semver>`.
  - Trusted publishing or signing per registry.
  - A CycloneDX SBOM per release.
  - `SECURITY.md` with the disclosure address `security@clikgate.com` (trust centre: https://clikgate.com/trust).
- **Versioning:** semantic versioning and a `CHANGELOG.md` per SDK. Deprecations are announced ≥ 6 months ahead. Runtime support is dropped only after that runtime's end of life.
- **Examples:** in `server/<lang>/examples/`, showing capture → save → `goal` → verify webhook.

## 20. Backend facts this contract relies on

These were checked in `clikgate_api` on 2026-10-26:

- **Goal events:**
  - `POST /v1/goals/events` → `201` new / `200` already received. Change 12 (re-checked 2026-10-28): the body is `GoalEventInfoResponse` with `status` (`GoalStatus`), `reason`, `goal_kind`, `counted`, `value_ignored`, `event_status` (the conversion state that `status` held before) and `payment` (section 23).
  - `POST /v1/goals/events/batch` → `200 {object: "list", data: [{index, ok, status, goal_event, error}]}` (≤ 500 events).
  - `POST /v1/goals/events/reverse` → `200 goal_event`.
  - Errors are listed in `docs/GOALS.md`.
- **Conversions:** `POST /v1/conversions` returns `201` (new) or `200` (existing `external_id`). `POST /v1/conversions/{id}/reverse` takes `{amount_minor?, reason?, external_id?}`.
- **Links** (re-checked against the built C6-B5 backend, 2026-10-26):
  - `POST /v1/links` → `201`.
  - `PATCH /v1/links/{id}` → `200` link, or `202` `LinkChangeRequestInfoResponse` (two-person approval), or `409 link_locked`. Live links on organisations with link safety can also get `422 https_required` / `422 destination_not_allowlisted`.
  - `warnings[]` on `link` (`LinkWarningResponse {code, message, param}`) includes `no_preview` on create and update when both `og_title` and `og_image_url` are empty.
  - `GET /v1/links/{id}/qr?format=svg|png&size&margin&dark&light`.
- **Clicks:** `GET /v1/clicks/{id}`.
- **Being added:** `GET /v1/server-sdk/config` (B.5) is coded to the spec shape. Until it is deployed, a 404 triggers the fail-closed path in 12.1.
- **Webhook `link.destination_changed`:** `data.object` is the link; `data` also carries `from`, `to`, `actor {type, id, api_key_prefix, requested_by?, change_request_id?}`, `actor_type` and `api_key_prefix` (`src/links/services/link_change_requests.py`). SDKs return it as any other event.
- **Webhook `subscription.updated` (change 10, backend C10 B2.8):** sent when a Growth add-on is activated, set to end at renewal, or kept. `data.object` is the subscription with `add_ons[]` (`key`, `name`, `status`, `amount_minor`, `ends_at`, `remove_at_renewal`); `data` also carries `previous_attributes`, `change` (`add_on.activated` or `add_on.remove_at_renewal`, the second also when "Remove at renewal" is undone: read `add_ons[].remove_at_renewal`) and `add_on_key`. Endpoints subscribe to it like the other `subscription.*` events. Webhook `type` stays a plain string in every SDK, so no type changes; conformance `webhooks.valid.subscription_updated`.
- **Plumbing:**
  - Errors: `src/core/errors.py`.
  - Idempotency: `src/core/idempotency/idempotent_route.py` (TTL `IDEMPOTENCY_TTL_SECONDS`).
  - Request IDs come back as `X-Request-Id`. Rate-limit headers are `RateLimit-Limit` / `-Remaining` / `-Reset` and `Retry-After` on 429.
- **Webhook signatures:** `src/core/webhook_signature.py`.
- **Click IDs:** prefixed ULIDs (`src/core/ids.py`). The web script cookie is `_cg_<param>`, `path=/`, `SameSite=Lax`, `Secure` on HTTPS (`src/static/clikgate.js`; its default lifetime is 7 days, and the server SDK default is 30 days, S.14).

## 21. Metadata filters and link metadata (change 10)

- **Wire:** the backend filters by link metadata with one query parameter per key: `?metadata[seller_id]=sel_ada`
  (`metadata_filters` in clikgate_api `src/links/routers/link_routers.py`). It reads them from the raw query string,
  so `openapi.json` doesn't declare them.
- **Operations:** `GET /v1/links`, `GET /v1/analytics/summary`, `/timeseries`, `/top-links` and `/open-in-app`.
  `codegen/filter.mjs` (`METADATA_FILTER_OPERATIONS`) adds a `metadata` map parameter (deepObject) to these, so the
  generated methods take it: Node `{ metadata: { seller_id: 'sel_ada' } }`, Python `metadata={"seller_id": "sel_ada"}`,
  PHP `metadata: ['seller_id' => 'sel_ada']`, Java and .NET a `"metadata"` entry holding a map in the query map. The
  hand-written `links.list` / `list_page` take it the same way.
- **Transport:** every SDK sends a map value in the query as `<name>[<key>]=<value>` (keys and values
  percent-encoded, null values skipped), lists as repeated parameters, scalars as before. Conformance
  `links.list.metadata_filter`.
- **Link metadata:** `Link.getMetadata()` (Java) and `Link.Metadata` (.NET) return the link's `metadata` (empty when
  none), next to `getExternalReference()` / `ExternalReference`. Node, Python and PHP links are plain objects
  (`link.metadata`, `link["metadata"]`).
- **`end_goal_value`** in analytics rows is a map of decimal strings per currency (`{"NGN": "18500.00"}`), next to
  `end_goal_value_minor` (`{"NGN": 1850000}`), the X.E10 convention. Node and Python type it so; PHP, Java and .NET
  return the JSON as parsed (strings stay strings).

## 22. Payments confirmed by the business's server (change 11, route D)

Backend contract C11 B2.2 and B2.3, with the change 12 updates. The website or app **reports** a payment by
sending a **Payment goal** with `goal()` (`provider` and `reference`, never an amount; change 12 removed the separate
`payment()` methods and their routes). The business's server **confirms** it right after its own verification with
the gateway, with these methods, or by sending the same Payment goal with `goals.send` and the value (section 23).
Clikgate counts the goal with the confirmed amount when the two match. The server SDKs never talk to a gateway and
never take a gateway key.

### 22.1 Methods

| Canonical | HTTP | Returns |
|---|---|---|
| `payments.confirm(params)` | `POST /v1/payments/confirmations` | the `payment_confirmation` object (`200`, new or repeat; `duplicate` says which) |
| `payments.from_paystack(response, options?)` | as `confirm` | the confirmation, or `null` when there is nothing to send |
| `payments.from_flutterwave(response, options?)` | as `confirm` | as above |
| `payments.from_monnify(response, options?)` | as `confirm` | as above |
| `payments.from_stripe(object, options?)` | as `confirm` | as above |
| `payments.build_from_paystack(response, options?)` (and `_flutterwave`, `_monnify`, `_stripe`) | none | the wire body the matching `from_*` would send, or `null`. Pure: no request, no config, no guard |

| Language | `confirm` | helpers | builders |
|---|---|---|---|
| Node | `payments.confirm({...})` | `payments.fromPaystack(res, {goal, clickId})` | `payments.buildFromPaystack(res)` |
| Python | `payments.confirm(provider=..., ...)` (also async) | `payments.from_paystack(res, goal=..., click_id=...)` | `payments.build_from_paystack(res)` |
| PHP | `payments->confirm([...])` | `payments->fromPaystack($res, ['goal' => ...])` | `payments->buildFromPaystack($res)` |
| Java | `payments().confirm(PaymentConfirmParams)` | `payments().fromPaystack(res, PaymentHelperOptions)` | `payments().buildFromPaystack(res)` |
| .NET | `Payments.ConfirmAsync(PaymentConfirmParams)` | `Payments.FromPaystackAsync(res, options)` | `Payments.BuildFromPaystack(res)` |

`response` is the gateway's parsed JSON in the language's usual form (Node object, Python `dict`, PHP array, Java
`Map` or Jackson `JsonNode`, .NET `JsonElement`) or the raw JSON text. Raw text is parsed with exact decimals
(Python `parse_float=Decimal`, PHP `JSON_BIGINT_AS_STRING`, Java `BigDecimal`, .NET the raw number text).

`options`: `goal` (a payment goal key) and `click_id` (wins over the `cg_click_id` in the gateway metadata). Both
optional.

### 22.2 `confirm` parameters (wire fields, section 2 casing in each language)

| Field | Rules (checked locally; failures throw `InvalidRequestError`, `http_status` null, nothing is sent) |
|---|---|
| `provider` | required: a `Provider` (section 23) or a provider-key string, `^[a-z][a-z0-9_]{1,29}$` → else `invalid_provider`. The helpers send their own `Provider` value |
| `reference` | required string, 1–128 characters → else `invalid_reference` |
| `status` | required, `success` \| `partial` \| `pending` \| `failed` \| `refunded` \| `reversed` → else `invalid_status` |
| `amount` | optional money (section 8 input types and formatting; an invalid value is `invalid_amount`, param `amount`) |
| `amount_minor` | optional non-negative integer → else `invalid_amount` (param `amount_minor`). Both `amount` and `amount_minor` → `amount_and_amount_minor` (param `amount`) |
| `currency` | optional, `^[A-Za-z]{3}$` (sent as given; the API upper-cases) → else `invalid_currency` |
| `occurred_at` | optional datetime or RFC 3339 string, formatted as for goals |
| `aliases` | optional list of strings, at most 5 → else `invalid_aliases` |
| `click_id`, `goal` (`^[a-z][a-z0-9_]{1,39}$` → else `invalid_goal_key`), `test` (boolean) | optional |
| `extra` | additional wire fields merged last (forward compatibility), subject to the guard |

- `null` means unset; unset fields are omitted. `aliases: []` is omitted.
- **Private-mode guard** (section 12.2), kind `payment_confirmation`. Allowed wire fields: `provider`, `reference`,
  `status`, `amount`, `amount_minor`, `currency`, `occurred_at`, `aliases`, `click_id`, `goal`, `test`, and the
  structural `refund_id` and `source_plugin` (through `extra`), as the backend allows. Anything else (only possible
  through `extra`, e.g. `order_id`) is refused with `PrivateModeFieldRejectedError` before anything is sent. In `auto`
  mode the config is loaded first, as for conversions. References are redacted in logs while the guard is on.
- One random `Idempotency-Key` per call, reused by its retries (section 7); retries as section 6. The `200` repeat
  (same provider, reference, status and amount) is success.
- API errors map as section 5: `403 plan_feature_unavailable` (`required_plan: "starter"`, `feature:
  "payment_goals"`: payment confirmations need Starter or above; change 12 replaced change 11's `sales_tracking`
  feature gate with this plan gate), `422 unknown_provider`, `invalid_status`, `invalid_amount`, `invalid_currency`,
  `amount_and_amount_minor`, `environment_mismatch`, `private_mode_field_rejected`.

### 22.3 The helpers (B2.3): extraction rules

A helper reads **only** the fields below and builds a `confirm` body. It never reads or sends customer details
(email, phone, card, authorization, IP, logs) and never sends the whole response.

| Helper | Unwraps | `reference` | `aliases` | `status` | `amount` (normal units) | `currency` | `occurred_at` | `test` | `click_id` |
|---|---|---|---|---|---|---|---|---|---|
| `from_paystack` | `data` when it is an object, else the root | `data.reference` | — | `success`→`success`; `failed`, `abandoned`→`failed`; `reversed`→`reversed`; `ongoing`, `pending`, `processing`, `queued`→`pending`; other → **null** | `data.amount` ÷ 100, every currency (XOF too) | `data.currency` | `paid_at`, else `paidAt`, else `created_at` | `domain` `"test"`→`true`, other string → `false` | `metadata.cg_click_id` |
| `from_flutterwave` | `data` when it is an object | `tx_ref`, else `reference` | `String(id)`, `flw_ref` | `successful`, `succeeded`→`success`; `failed`, `voided`→`failed`; anything else → `pending` | `amount` as is | `currency` | `created_at`, else `created_datetime` | — | `meta.cg_click_id`, else `meta_data.cg_click_id` |
| `from_monnify` | `responseBody` when it is an object, then `eventData` when it is an object | `paymentReference` | `transactionReference` | `PAID`, `OVERPAID`→`success`; `PARTIALLY_PAID`→`partial`; `FAILED`, `CANCELLED`, `ABANDONED`, `EXPIRED`→`failed`; `PENDING`→`pending`; `REVERSED`→`reversed`; other → **null** (compared upper-case) | `amountPaid` as is | `currency`, else `currencyCode` | `paidOn` only when ISO 8601 (else omitted) | — | `metaData.cg_click_id` |
| `from_stripe` | none | PaymentIntent (`object: "payment_intent"`): `id`. Checkout Session (`object: "checkout.session"`): `payment_intent` (its `id` when expanded), else `id` | Session: `id`, `client_reference_id` | PI: `succeeded`→`success`, `canceled`→`failed`, `processing` and `requires_*`→`pending`, other → **null**. Session: `payment_status` `paid`→`success`; `no_payment_required` → **null**; otherwise `failed` when `status` is `expired`, else `pending` | PI `amount_received` when > 0, else `amount`; Session `amount_total`. ÷ 100 unless zero-decimal (`BIF CLP DJF GNF JPY KMF KRW MGA PYG RWF VND VUV XAF XOF XPF`); ISK and UGX are ÷ 100 | upper-cased | `created` (Unix seconds) | `!livemode` | `metadata.cg_click_id` |

Common rules:

- **Status matching:** Paystack, Flutterwave and Stripe compare lower-case; Monnify upper-case.
- **Null result:**
  - A helper returns `null` (and `from_*` sends nothing) when the input isn't an object (or JSON text of one), when
    there is no reference, or when the status maps to **null** above.
  - `from_*` then warns `unrecognised_payment_response` once per call. A Stripe `no_payment_required` session
    returns `null` without a warning.
- **Strings:** string fields are trimmed. Empty strings count as absent. A numeric reference or id is converted
  with its base-10 digits.
- **Amounts are exact decimals, never floats:**
  - Read the amount from an integer, a decimal string, a native decimal, or a float through its shortest round-trip
    text (Python `repr`, Java `BigDecimal.valueOf`, .NET `"R"` / the raw JSON text, PHP `json_encode`).
  - Divide by 100 by moving the decimal point.
  - Send the shortest exact decimal: no exponent, no trailing fractional zeros, no trailing `.`. So `750000`
    Paystack NGN is `"7500"`, `"10.70"` is `"10.7"`, and `"100.00"` is `"100"`.
  - A missing, empty or unparsable amount (or a negative one) is omitted, and the API decides.
  - `amount_minor` is never sent by a helper.
- **Currency:** trimmed and upper-cased. Omitted when absent.
- **Times:**
  - A number is Unix seconds, or milliseconds when above 10^11.
  - A string must be ISO 8601: `YYYY-MM-DD`, then `T` or a space, then `HH:MM[:SS[.fraction]]`, then an optional
    `Z`, `±HH:MM` or `±HHMM` (no zone means UTC).
  - The time is sent in UTC, formatted as for goals (`2026-10-28T10:00:00Z`, with milliseconds only when they are
    not zero; finer digits are truncated).
  - Anything else (Monnify's `dd/MM/yyyy hh:mm:ss a`) is omitted.
- **Click IDs:**
  - The metadata may be an object or JSON text of one.
  - Only `cg_click_id` is read, and it is sent only when it is a valid click ID (section 13).
- **Aliases:** trimmed, empty ones dropped, duplicates and the reference itself removed, first 5 kept. Omitted when
  none are left.
- **Key order** doesn't matter. The conformance judge compares the JSON body exactly (no extra keys).
- **Vectors:** the extraction vectors live in `conformance/vectors/payment-helper-vectors.json`, a copy of
  `clikgate_api/docs/payment-helper-vectors.json`. `build-cases.mjs --check` fails when the two differ.

### 22.4 Where to call them

Call `from_*` (or `confirm`) **right after your own server has verified the payment with the gateway** (Paystack
`GET /transaction/verify/{reference}`, Flutterwave `GET /v3/transactions/{id}/verify`, Monnify
`GET /api/v2/transactions/{transactionReference}`, Stripe `paymentIntents.retrieve` or the
`checkout.session.completed` webhook you already verify). Never call them with data from the browser or the app.
Also call them for refunds (`status: refunded`, `amount` = the refunded amount).

### 22.5 Conformance

| `call` | `args` | Canonical result |
|---|---|---|
| `payments.confirm` | the 22.2 fields in `snake_case` (+ `extra`, `idempotency_key?`) | the confirmation |
| `payments.from` | `gateway` (`paystack` \| `flutterwave` \| `monnify` \| `stripe`), `response` (any JSON), `goal?`, `click_id?` | the confirmation, or `null` |
| `payments.build` | as `payments.from` | `{"value": body \| null}` (compared exactly) |

Runners convert `response` to the type their helper takes (section 22.1) without changing numbers: JSON floats such
as `1500.25` must reach the helper as the same decimal.

## 23. Goal kinds, goal status and the shared enums (change 12)

Backend contract C12 B1–B3 (final). Every goal is **Standard** or **Payment** (`kind`, set only in the goal's
settings: never in a goal call, D4). `goal()` is the only goal method; there is no `payment()` method in any SDK.

### 23.1 The enums

| Enum | Values (wire) | Node | Python | PHP | Java | .NET |
|---|---|---|---|---|---|---|
| `GoalKind` | `standard`, `payment` | `GoalKind.Payment` (type `'standard' \| 'payment'`) | `GoalKind.PAYMENT` | `GoalKind::Payment` | `GoalKind.PAYMENT` | `GoalKind.PAYMENT` |
| `GoalStatus` | `counted`, `waiting`, `refused`, `received` (change 22 R.9) | `GoalStatus.Counted` | `GoalStatus.COUNTED` | `GoalStatus::Counted` | `GoalStatus.COUNTED` | `GoalStatus.COUNTED` |
| `Provider` | every provider in `GET /v1/payment-gateways`, plus `shopify`, `woocommerce`, `custom` | `Provider.Paystack` | `Provider.PAYSTACK` | `Provider::Paystack` | `Provider.PAYSTACK` | `Provider.PAYSTACK` |

- **Generated, never hand-written:** `node server/codegen/generate.mjs` writes them from `openapi.json`'s
  `components.schemas` (`GoalKind`, `GoalStatus`, `Provider`) into `node/src/enums.ts`, `python/src/clikgate/_enums.py`,
  `php/src/Enum/*.php`, `java/.../com/clikgate/model/{GoalKind,GoalStatus,Provider}.java` and
  `dotnet/src/Clikgate/Enums.cs`. `--check` fails when the backend's gateway list changes and the SDKs weren't
  regenerated.
- **Wire values:** Python members are `str` (`GoalStatus.COUNTED == "counted"`). PHP enums are backed by the wire
  string. Java has `getValue()` / `fromValue()`, .NET `ToWire()` / `ClikgateEnums.ParseGoalStatus()`.
- **`Provider` takes newer gateways:** every input that takes a `Provider` also takes the provider-key string (Node
  `Provider | string`, Python `Provider | str`, PHP `Provider|string`, Java an overload and `Provider.fromString("…")`,
  .NET `Provider.FromString("…")` or a string, converted implicitly). The API validates it (`422 unknown_provider`).

### 23.2 Goal results

Every goal call returns (batch items: in `goal_event`) the `goal_event` with:

| Field | Values |
|---|---|
| `status` | `GoalStatus` (Node and Python: the wire string, which equals the enum member; Java `getStatus()` and .NET `Status` return the enum, or null for a value this SDK doesn't know) |
| `reason` | `null` when counted; else `waiting_for_confirmation`, `pending_click`, `already_counted_for_click`, `unattributed`, `rejected_bot`, `outside_window`, `already_counted`, … (a plain string: new reasons can appear) |
| `goal_kind` | `GoalKind` of the goal |
| `counted` | `status == "counted"` (change 09, kept) |
| `value_ignored` | `true` when the value was dropped (browser and app senders of a Payment goal) |
| `event_status` | the conversion state that `status` held before change 12 (`attributed`, `unattributed`, `rejected_bot`, …), or null while a Payment goal waits |
| `payment` | for a Payment goal sent by the server: `{confirmation_id, match_status, report_id, provider}`; else null |

- `waiting`, `refused` and `received` are **results**, not errors: `goals.send` returns them, background `goal()`
  doesn't pass them to `on_error`, and none is retried. 4xx errors stay errors (section 5).
- **`received` (change 22 R.9, R.10):** a name that isn't ticked as a goal yet answers `200 {status: "received", reason:
  "not_counted_yet"}`; an archived goal answers `received` with reason `goal_archived` (no longer `410 goal_archived`).
  The event is stored for 30 days, not counted, not metered and not sent to ad networks. Conformance:
  `goals.send.status.received_not_counted_yet` and `goals.background.received_not_counted_yet`.
- **Strict goal names (change 23 R.1, R.2, R.9):** with the organisation's "Allow unknown goal names" off, a name with
  no goal (or alias) behind it answers `422 unknown_goal` and an archived goal `422 goal_archived` (an error envelope,
  like `payment_goal_needs_confirmation`, or the refusal body of section 5; both map to `InvalidRequestError` with that
  code). Both are **final**: `goals.send` throws once (422 is never retried); background and sync `goal()` pass it to
  `on_error` with `dropped: true` and never re-queue it; a batch item is a per-item failure. The SDK **never checks names
  itself and never caches the setting** (the section 12.3 `unknown_goal` warning stays warn-only and the event is still
  sent): a refused name is sent again next time. Each refusal logs the section 15 debug line with the goal name only,
  never the reference, customer ID, values or labels. Conformance: `goals.send.refused.*`,
  `goals.background.refused.*`, `goals.batch.refused.unknown_goal_item`.
- **A Payment goal from the business's server** is a trusted confirmation (route D): send it with `goals.send`/`goal()`
  and the confirmed `value` (required, above 0), `currency`, `provider` and `reference` (both required: `422
  payment_goal_needs_confirmation` with `missing` otherwise; there is no default provider) (the payment
  reference; deduplicated by `(provider, reference)`). With a `click_id` (not `code`, `422 code_not_supported`) it is
  counted at once; without one it is `waiting` (its `id` is then the confirmation id, `pcf_…`) until the browser's or
  app's report arrives or the confirmation wait ends. `payments.confirm` and the helpers (section 22) remain the way
  to confirm from a gateway's verified response.
- **Goal management** (`api.goals.*`, generated): the goal object has `kind` (`GoalKind`) and `suggest_payment`, and
  no `confirmation`; `createGoal` / `updateGoal` take `kind`, `updateGoal` also `confirm_kind_change` (`409
  kind_change_needs_confirmation`, `422 invalid_goal_kind`, `403 plan_feature_unavailable`).

### 23.3 Forward compatibility

An SDK released today MUST keep working against a newer API:

- Unknown response fields are ignored and kept: Node, Python and PHP return the wire JSON as is; Java and .NET models
  keep the raw JSON (`raw` / `Raw`), and their conformance runners serialise it back.
- An enum value this SDK release doesn't know (a new `GoalStatus`, `GoalKind`, `reason` or `Provider`) is never an
  error: the wire string is kept; typed getters return null.
- Unknown keys in an error envelope are kept in `raw`; the class still follows section 5.
- Conformance suite `compat` checks this for goal events, batches, background sending, config, payment confirmations,
  links, errors and webhooks; suite `goals` checks every `status` value and the B2 error codes.


## 24. People: `identifyUser` and goal labels (change 14)

- **Method** (section 2 casing): Node `identifyUser(params, requestOptions?)`, Python `identify_user(*, click_id, app_id,
  installation_id, customer_id, label, request_options)` (sync and async), PHP `identifyUser(array $params, array
  $requestOptions = [])`, Java `identifyUser(IdentifyUserParams[, RequestOptions])` → `PersonIdentified`, .NET
  `IdentifyUserAsync(IdentifyUserParams, RequestOptions?, CancellationToken)` → `PersonIdentified`.
- **Wire:** `POST /v1/people/identify` `{click_id?, app_id?, installation_id?, customer_id?, label?}` (nulls omitted),
  answer `{object: "person_identified", person_id, label_ignored: "plan" | "lower_rank" | null}` returned as is.
- **Local checks** (before any request): `app_id` and `installation_id` together (`invalid_request`, param the missing
  one); at least one of `click_id`, the installation, `customer_id` (`invalid_request`, param `click_id`).
- **Guard** (section 12.2): kind `identify` allows `click_id`, `app_id`, `installation_id`, `label`; `customer_id` is
  refused (`private_mode_field_rejected`). Goals allow `label` too. The server SDK config has no labels switch, so the
  API decides (`422 labels_off_in_private_mode`, an `InvalidRequestError`).
- **Goals:** optional `label` (wire `label`) on `goal`, `goals.send` and batch events; `is_first` is unchanged (from the
  server it is what counts a new customer).
- The removed `POST /v1/apps/{app_id}/identify` is gone from the generated layer. Conformance: suite `people` (6 cases).
- **Path B (change 22 I.6, R.25, R.26):** the app reads `getInstallationId()` and sends it in its sign-in request; the
  server calls `identifyUser` with `app_id`, `installation_id`, `customer_id` (and `label`) after sign-in and at every
  signed-in app open, and skips the call when the app sends no installation ID (tracking off). No identity secret or
  token is needed; the API accepts installations active in the last 7 days, and the call satisfies
  `require_identity_token`. Each SDK's `identifyUser` doc comment and README show this path next to path A (section 26)
  and link to https://clikgate.com/docs/identify-users.


## 26. Identity tokens: `createIdentityToken` (change 22 I.1, R.22, R.27)

The default way for an app to prove which of the business's users is signed in (path A of
https://clikgate.com/docs/identify-users): the business's server signs a token and returns it in responses the app
already calls (sign-in, "current user"); the app passes it to the mobile SDK's `identifyUser(label?, customerId,
identityToken)`.

- **Token** (SDK spec 8.5, the backend's `sign_identity_token`):
  `base64url_nopad(HMAC_SHA256(secret, customer_id + "." + issued_at)) + "." + issued_at`, with `secret` and the message
  encoded as UTF-8, no Unicode normalisation, and `issued_at` in whole Unix seconds (now, by default). No network call
  and no API key.
- **Names** (section 2 casing):

  | | Function (no client) | Client method | Options / config |
  |---|---|---|---|
  | Node | `createIdentityToken(customerId, { appId?, secret?, issuedAt? })` | `clikgate.createIdentityToken(customerId, { appId? })` | `identitySecret`, `identitySecrets` |
  | Python | `create_identity_token(customer_id, *, app_id=None, secret=None, issued_at=None)` | `Clikgate.create_identity_token(customer_id, *, app_id=None, issued_at=None)` (plain method on `AsyncClikgate` too) | `identity_secret`, `identity_secrets` |
  | PHP | `Clikgate\IdentityToken::create(string $customerId, array{appId?, secret?, issuedAt?} $options = [])` | `$clikgate->createIdentityToken($customerId, ['appId' => …])` | `identitySecret`, `identitySecrets` |
  | Laravel | | `Clikgate::createIdentityToken($customerId, ['appId' => …])` | `clikgate.identity_secret`, `clikgate.identity_secrets` |
  | Java | `IdentityTokens.create(customerId)`, `create(customerId, appId)`, `create(customerId, secret, issuedAtSeconds)` | `clikgate.createIdentityToken(customerId[, appId])` | builder `identitySecret(...)`, `identitySecrets(Map)` |
  | Spring Boot | | the bean's `createIdentityToken` | `clikgate.identity-secret`, `clikgate.identity-secrets.<appId>` |
  | .NET | `IdentityTokens.Create(customerId, appId = null)`, `Create(customerId, secret, issuedAtSeconds)` | `client.CreateIdentityToken(customerId, appId = null)` (also on `IClikgateClient`) | `IdentitySecret`, `IdentitySecrets`; ASP.NET Core `Clikgate:IdentitySecret`, `Clikgate:IdentitySecrets:<appId>` |

- **Which secret:** an explicit `secret` (function form only); else, with `app_id`, that app's entry in the client's
  `identity_secrets` or the `CLIKGATE_IDENTITY_SECRETS` environment variable (a JSON object `{"app_…": "cgis_…"}`);
  else the client's `identity_secret` or `CLIKGATE_IDENTITY_SECRET`. With several apps' secrets and no `app_id` and no
  single secret: `ConfigurationError` `missing_identity_secret` (param `app_id`). No secret at all:
  `ConfigurationError` `missing_identity_secret`. A malformed `CLIKGATE_IDENTITY_SECRETS`: `ConfigurationError`
  `invalid_identity_secrets` (the value is never echoed). Laravel reports a malformed `identity_secrets` only when a
  token is created, so the rest of the client keeps working.
- **Customer ID:** 1-255 characters, counted as Unicode code points (as the backend's identify schema); else
  `InvalidRequestError` `invalid_customer_id` (param `customer_id`), never echoed. PHP also refuses invalid UTF-8.
- **Server only** (R.27): `ClikgateServerOnlyError` (code `server_only`; PHP, Java and .NET `ClikgateServerOnlyException`)
  - Node: when `window`, `document` or React Native (`navigator.product === "ReactNative"`) is detected;
  - Java: when `android.os.Build` loads;
  - .NET: under MAUI or Xamarin (OS platform Android, iOS, tvOS, Mac Catalyst or watchOS, or `Microsoft.Maui`,
    `Microsoft.Maui.Controls`, `Xamarin.*`, `Mono.Android`, `Microsoft.iOS`/`Android`/`MacCatalyst`/`tvOS` loaded; not
    `Microsoft.Maui.Graphics` alone, which also runs on servers) and in browser (WebAssembly) or WASI builds;
  - Python: in Pyodide / Emscripten / WASI builds and CPython on iOS or Android (`sys.platform` `emscripten`, `wasi`,
    `ios`, `android`). A regular Python process can't be bundled into an app or website, so that is the whole risk;
  - PHP: not applicable (PHP has no browser or mobile build); no check and no exception class.
- **Never logged:** the secret, the token and the customer ID appear in no log line or error message.
- **Vectors:** `server/conformance/vectors/identity-token-vectors.json` (built by
  `server/conformance/tools/build_identity_token_vectors.py` from the backend's `sign_identity_token`; `--check` fails when
  stale). Every language's unit tests check every vector (ASCII, dots, combining marks, precomposed vs decomposed é,
  CJK, an emoji outside the BMP, Arabic, 255 characters, `issued_at` 0 and after 2038, a second app's secret, a
  non-ASCII secret) and refuse every `invalid_customer_ids` entry.
- **Verification reasons** (backend, R.22) the docs list: `expired`, `bad_signature`, `secret_rotated`, `no_secret_set`,
  `not_yet_valid` (issued more than 5 minutes ahead). The SDKs never verify tokens.


## 25. Hashed email and phone for ad network matching (change 19)

Backend C19-B4 (spec change 19 B.5, R.3-R.5; `clikgate_api/src/goals/schemas/goal_event_schemas.py`,
`src/conversions/schemas/report_conversion_schema.py`, `src/ads/utils/matching.py`, checked 2026-11-04). A business
that turned on "match by hashed email or phone" for an ad network destination can send its own SHA-256 hashes with a
goal. Clikgate never hashes on the business's behalf in private mode: **hash on your own server**, with the helper.

- **Goal options** (section 9.1; on `goal`, `goals.send` and batch events), all optional:

  | Canonical (wire) | Node | What it is |
  |---|---|---|
  | `hashed_email` | `hashedEmail` | SHA-256, 64 lowercase hex characters, of the email trimmed and lowercased |
  | `hashed_phone_e164` | `hashedPhoneE164` | SHA-256 of the phone in E.164 **with** the `+` (`+2348031234567`) |
  | `hashed_phone_digits` | `hashedPhoneDigits` | SHA-256 of the phone digits with the country code, no `+` (`2348031234567`) |

  Conversions (`conversions.create`) take the same wire fields in `params`. The API sends each ad network only the
  form it documents (LinkedIn takes no phone), so send both phone forms when you have a phone.
- **Local check** (section 5, before anything is sent): a non-null value that isn't `^[0-9a-f]{64}$` is an
  `InvalidRequestError` with code `invalid_hashed_identifier` (the backend's code) and `param` = the wire field. The
  value is never echoed in the message or logs. Uppercase hex is refused, not lowercased (it is not what the helper
  makes, so it points at a different normalisation).
- **Guard** (section 12.2): the three fields are allowed for `goal` and `conversion` payloads. The API decides the
  rest: in private mode they are accepted only while a destination matches by hashed identifiers, and only from a
  server API key (every server SDK uses one); raw values are refused (`422 private_mode_field_rejected`).
- **The helper** `hash_for_ads(email?, phone?)` (section 2 casing: Node `hashForAds({ email, phone })`, Python
  `hash_for_ads(email=None, phone=None)`, PHP `Clikgate\HashForAds::hash(?string $email, ?string $phone)`, Java
  `HashForAds.hash(String email, String phone)` → `HashedIdentifiers`, .NET `HashForAds.Hash(string? email, string?
  phone)` → `HashedIdentifiers`). Pure, offline, no client needed. It returns the goal options for the values given
  (absent or null inputs give no field), ready to pass to `goal()`:
  - **email:** trimmed (Unicode whitespace at both ends) and lowercased (locale-independent); it must contain `@`.
    `hashed_email` = SHA-256 (UTF-8, lowercase hex) of that.
  - **phone:** must include its country code: after trimming it starts with `+` or `00`. Every non-digit is removed,
    a leading `00` is dropped, and the rest must be 7 to 15 digits starting with 1-9 (E.164, as the backend's
    `^\+[1-9]\d{6,14}$`). `hashed_phone_digits` = SHA-256 of the digits; `hashed_phone_e164` = SHA-256 of `+` and the
    digits. A national number (`0803 123 4567`) is refused: add the country code yourself, the SDK never guesses it.
  - **Errors:** `InvalidRequestError` `invalid_argument` with `param` `email` or `phone`; the input is never echoed.
  - **Vectors** (the same as the website's `samples/ads-hashing/`): `"  Ada.Obi@Example.com "` →
    `0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed`; `"+234 803 123 4567"` → e164
    `6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c`, digits
    `fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17`; `"00234 803 123 4567"` gives the same phone
    hashes.
- **Never logged:** hashed values are left out of every SDK log line and `on_error` context, like values (9.5).
- **Docs:** each README's goals section shows `hashForAds` with a goal and says "in private mode, hash on your own
  server; Clikgate never hashes for you there".
- **Generated layer:** `api.goals.*` and `api.conversions.*` request types gain the three fields when the generated
  layer is regenerated from an `openapi.json` that has them (section 16); the hand-written options above don't wait for
  that.
- Conformance: suite `ads_matching` (call `hash_for_ads`, and goal / conversion / guard cases).

