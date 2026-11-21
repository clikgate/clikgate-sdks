# Clikgate server SDKs: the shared contract

Version 1.0 (2026-10-26), with the additions of 2026-10-28 (section 23). This document is normative for `@clikgate/node`, `clikgate` (Python),
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
21. [Metadata filters and link metadata](#21-metadata-filters-and-link-metadata)
22. [Payments confirmed by the business's server](#22-payments-confirmed-by-the-businesss-server)
23. [Goal kinds, goal status and the shared enums](#23-goal-kinds-goal-status-and-the-shared-enums)
24. [People: `identifyUser` and goal labels](#24-people-identifyuser-and-goal-labels)
25. [Hashed email and phone for ad network matching](#25-hashed-email-and-phone-for-ad-network-matching)
26. [Identity tokens: `createIdentityToken`](#26-identity-tokens-createidentitytoken)
27. [Existing customers: account dates and known customers](#27-existing-customers-account-dates-and-known-customers)
28. [Typed models and referrals: `clikgate.referrals`](#28-typed-models-and-referrals-clikgatereferrals)
29. [Typed webhook events](#29-typed-webhook-events)
30. [Privacy requests: `clikgate.privacy`](#30-privacy-requests-clikgateprivacy)
31. [Links: typed inputs, the full model and more methods](#31-links-typed-inputs-the-full-model-and-more-methods)
32. [People, installs and codes](#32-people-installs-and-codes)

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
- Runtime dependencies:
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
  - The resources of sections 28-32 return typed models in every SDK (section 28).
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

- **User-Agent** (the backend parses it; nothing else is sent, no telemetry):

  ```
  clikgate-<sdk>/<sdk version> (<runtime> <runtime version>; <os> <arch>)
  clikgate-node/1.0.0 (node 24.11.0; linux x64)
  clikgate-python/1.0.0 (python 3.12.4; windows x64)
  ```

  - `<runtime version>` has no leading `v`. For Java it is `java.version`; for .NET, `Environment.Version`.
  - **Sanitising (required by the backend parser):** `<sdk version>` and `<runtime version>` MUST match `^[0-9][0-9A-Za-z.+-]{0,39}$`. Replace any other character with `-` and truncate to 40 characters, so Java `1.8.0_402` becomes `1.8.0-402`. The backend keeps `sdk`, `sdk_version`, `runtime` and `runtime_version` (shown in Developers → SDKs and `GET /v1/developers/sdks`, with `latest_version`, `update_available` and `below_minimum`). A runtime version that fails the regex is silently stored as part of the runtime name.
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

The backend's error envelope:

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
- **A goal refusal body**: a response with no `error` object whose body is a JSON object with `status: "refused"` and a non-empty string `reason` (`422 {"status": "refused", "reason": "unknown_goal", "counted": false, "goal_kind": null}`) takes `code` = that `reason`. The body is the `raw` object; `param` and `type` are null; `message` follows the rule above. The class still follows the status.

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
  | `test_destination_not_allowed` | 422 → `InvalidRequestError` | `allowed` (list: `clikgate_test_page`, `verified_site`, `local_address`, `verified_tunnel`) → `allowed`; `doc_url` → `docUrl` | backend |
  | `test_link_limit_reached` | 403 → `PermissionError` | `limit` → `limit` | backend |
  | `domain_mode_mismatch` | 422 → `InvalidRequestError` (param `domain`) | — | backend |
  | `plan_limit_reached` | 403 → `PermissionError` (`param` = the allowance key) | `required_plan` → `requiredPlan` | backend |
  | `plan_upgrade_required`, `feature_disabled` | 403 → `PermissionError` | `required_plan` → `requiredPlan` | feature gates such as exports and summaries |
  | `plan_feature_unavailable` | 403 → `PermissionError` | `required_plan` → `requiredPlan` (`starter`); `feature` (`payment_goals`) stays in `raw` | Payment goals, payment reports and `payments.confirm` need Starter or above |
  | `cli_scope` | 403 → `PermissionError` | — (a setup-command token was used; server SDKs need an API key) | backend |
  | `link_locked` | 409 → `LinkLockedError` (`param` = the first locked field) | — | backend |
  | `https_required` | 422 → `InvalidRequestError` (`param` = the URL field) | — (the organisation allows only `https://` destinations; live links) | backend |
  | `destination_not_allowlisted` | 422 → `InvalidRequestError` (`param` = the URL field) | — (the organisation requires its destination allowlist; live links) | backend |
  | `private_mode_field_rejected` | 422 → `PrivateModeFieldRejectedError` | `param` → `field` | backend |
  | `unknown_provider` | 422 → `InvalidRequestError` (param `provider`) | — (a well-formed provider the API doesn't know) | |
  | `value_required`, `invalid_value`, `code_not_supported` | 422 → `InvalidRequestError` (param `value` / `code`) | — (a Payment goal sent by the server needs a value above 0 and takes `click_id`, not `code`) | backend |
  | `payment_goal_needs_confirmation` | 422 → `InvalidRequestError` (param `provider` or `reference`) | `missing` (list) stays in `raw` | a Payment goal without `provider` or `reference`, from any sender (also `goals.send` and `conversions.create`) |
  | `unknown_goal` | 422 → `InvalidRequestError` (param `goal`, or null for a refusal body) | `status`, `reason`, `counted`, `goal_kind` stay in `raw` | "Allow unknown goal names" is off and no goal (or alias) has this name. Final: never retried (section 23.2) |
  | `goal_archived` | 422 → `InvalidRequestError` | — | the goal is archived and "Allow unknown goal names" is off (with the setting on it is a `received` result, never `410`) |

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
| `goals.send`, and each single goal sent by `goal()` in sync mode | a random UUID v4 per call, reused across its retries (never a hash of the reference) |
| `goals.send_batch` and background batches | a random UUID v4 per batch request, reused across its retries |
| `goals.reverse`, `conversions.*`, `links.create`, `links.update`, every other POST/PATCH (including `api.*`) | a random UUID v4 per logical call, reused across its retries |
| GET, DELETE | none |

- Every POST/PATCH method takes an optional `idempotency_key` request option, which overrides the default.
- **Why goal keys are random (since 1.1.0):** the backend dedupes goal events by `(organization, goal, reference_hash)` itself, in every mode, so a resend after a crash, with a new key, returns `200` with the stored event and is never counted twice. A Payment goal sent by the server (section 23) is deduplicated by `(provider, reference)` the same way. The key only makes the retries of one call safe. Versions before 1.1.0 (never released) sent `sha256_hex(goal + ":" + reference)`; no SDK computes that key any more.
- **Same goal and reference, different body:** the backend returns the stored event (`200`); a goal can't be "corrected" by resending. Use `goals.reverse`. Batch items say the same with `status: 200` on the item.
- **Reversals use random keys** because two identical partial refunds are legitimate.
- **Backend behaviour**:
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

**Responses:** they carry `value` as a decimal string (or `null`), and also `value_minor` (and `reversed_value_minor`), the same amount as an integer in the currency's minor units (or `null`). SDKs MUST NOT convert `value` to a float, and pass both fields through. Node and Python return the string. Java and .NET MAY expose `BigDecimal` / `decimal` getters next to the raw string.

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
| `provider` | `provider` | `Provider` (section 23) or a provider-key string | the gateway of a payment; `^[a-z][a-z0-9_]{1,29}$` locally (`invalid_provider`), the API checks the value (`422 unknown_provider`). A string lets you name a gateway added after your SDK release |
| `is_first` | `isFirst` | boolean | |
| `occurred_at` | `occurredAt` | datetime or RFC 3339 string | |
| `metadata` | `metadata` | object ≤ 8 KB | refused in private mode |
| `kept_by` | `keptBy` | `server_cookie\|script_cookie\|form\|payment_metadata\|unknown` | how the click ID was kept (`click_ids.context`, 13.1); unknown values are a local `invalid_request` |
| `browser_engine` | `browserEngine` | `webkit_ios\|safari_mac\|chromium\|gecko\|other` | from `click_ids.context` |
| `platform` | `platform` | `ios\|android\|macos\|windows\|linux\|other` | from `click_ids.context` |
| `consent` | `consent` | object | the four-purpose consent object; allowed in private mode (no identity in it) |
| `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` | `hashedEmail`, `hashedPhoneE164`, `hashedPhoneDigits` | 64 lowercase hex | your own SHA-256 hashes for ad network matching (section 25); `hash_for_ads` makes them; other values are a local `invalid_hashed_identifier` |
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
- **Payment goals:** with `goal` set to a Payment goal, `conversions.create` is the same
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
  - `domain_badge`: `"premium"` on `ciz.to` links, else `null`.
  - `locked`, `locked_by`, `locked_at`. Locking is `POST /v1/links/{id}/lock` (`links:write`, generated `api.links.*`); unlocking needs `org:manage`.
- **Test links** (test-mode keys only):
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
  - `202` (two-person approval): `applied: false`, and `change_request` is the body:

    ```json
    {"object": "link_change_request", "id": "lcr_…", "link_id": "lnk_…", "status": "pending", "from_url": "https://old", "to_url": "https://new",
     "requested_by": "…", "requested_by_type": "api_key", "decided_by": null, "decided_at": null, "decision_note": null,
     "expires_at": "…", "created_at": "…", "livemode": true}
    ```

    This is the backend's `LinkChangeRequestInfoResponse`. `status` is `pending`, `approved`, `rejected` or `expired`. Approving or rejecting needs a dashboard user (`403 approval_requires_user` for API keys; the generated `api.linkChangeRequests.*` calls exist but answer that for keys).

  - `409 link_locked`: throws `LinkLockedError`, which is never retried. Unlocking needs `org:manage` in the dashboard.
- **Pagination:**
  - The backend uses cursors: `limit` (1–100, default 25), `starting_after`, `ending_before`. The response has `has_more` and `next_cursor`.
  - The iterator requests the next page with `starting_after = next_cursor` and keeps the caller's other params.
  - It stops when `has_more` is false or `next_cursor` is null.
  - Pages are fetched lazily, one request at a time.
  - Node: `for await (const link of clikgate.links.list({ limit: 100 }))`. Python: `for link in clikgate.links.list()`. Java: `Iterable<Link>`. .NET: `IAsyncEnumerable<Link>`.

## 12. Server SDK config and the private-mode guard

### 12.1 Config

`GET /v1/server-sdk/config` (any valid API key):

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
| goal event (`goals.send`, `goal()`, batch items) | `goal`, `click_id`, `code`, `reference`, `value`, `currency`, `is_first`, `occurred_at`, `consent` (the four-purpose consent object), `provider`, `kept_by`, `browser_engine`, `platform` (13.1), `label`, `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` (section 25) |
| conversion (`conversions.create`) | the above + `external_id` |
| reversal (`goals.reverse`, `conversions.reverse`) | `goal`, `reference`, `value`, `external_id`, `amount_minor` |

- **Source of truth:** these lists match the backend's private-mode field lists for goals, conversions and
  confirmations, re-checked 2026-10-28. The reversal list is stricter than the backend's on purpose (free-text
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
- **Cookie name:** `_cg_<param>`, the same first-party cookie the web script writes.

| Canonical | Behaviour |
|---|---|
| `click_ids.is_valid(id)` | regex test; non-strings are false |
| `click_ids.from_request(request)` | 1. the query parameter `param` (the first occurrence whose value is valid); 2. the cookie `_cg_<param>` (cookie value URL-decoded); 3. the header `Clikgate-Click-Id` (case-insensitive, trimmed). The first **valid** value wins; invalid values are skipped. Returns the ID or null |
| `click_ids.cookie_header(id, {days = 30, secure = true, domain?})` | the `Set-Cookie` value, attribute order exact: `_cg_<param>=<id>; Path=/; Max-Age=<days*86400>[; Domain=<domain>]; SameSite=Lax[; Secure]`. **Not** `HttpOnly`, because the web script reads it. An invalid ID raises `InvalidRequestError invalid_click_id` |
| `click_ids.persist(response, id, options)` | appends that header to the framework's response, **keeping** existing `Set-Cookie` headers, then the marker `_cg_kept=s` with the same `Path`, `Max-Age`, `Domain`, `SameSite` and `Secure` (so the web script reports `kept_by: server_cookie`). If `secure` isn't given, it is true when the request is HTTPS (TLS socket, or `X-Forwarded-Proto: https`), and true when unknown |
| `click_ids.keep_route(options)` | the `/cg/keep` handler (13.1) |
| `click_ids.from_payment_metadata(payload)` | below |

**`from_payment_metadata(payload)`** matching the backend:

1. If `payload` is a string, parse it as JSON. If that fails, return null.
2. Candidates, in order: `payload`, then `payload.data` (Paystack and Flutterwave webhook envelopes), when it is an object.
3. For each candidate, the containers in order are: the candidate itself, then `metadata`, `meta`, `meta_data`, `note_attributes`, `attributes`, `custom_attributes`, `customAttributes`.
   - An object container is used as is.
   - A string container is parsed as JSON.
   - A list container of `{name | key | variable_name | display_name, value}` items becomes a map.
4. In each container, check the keys `cg_click_id`, `cgid`, `clikgate_click_id` in that order. Then, if the container has a `custom_fields` list, check it the same way (Paystack).
5. The first value that is a string and `is_valid` wins. Otherwise return null.

**Framework neutrality:** `from_request` and `persist` accept the language's common request and response types. The conformance cases describe a request as `{url, headers}` and the runner builds the native object.

### 13.1 `/cg/keep`

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

**Visitor context for goals:** goals the business's server sends MAY carry `kept_by`
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

The header:

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

- **Surface:** `client.api.<resource>.<operation>(…)` exposes every API-key operation in `openapi.json`. Resources come from the OpenAPI tag (`Ad Spend` becomes Node `adSpend`, Python `ad_spend`). Operations come from the summary (`List Links` becomes `listLinks` / `list_links`).
- **One code path:** generated code MUST call the SDK's own request function, so the transport, User-Agent, retries, idempotency keys, errors and logging are the hand-written ones. There is no second HTTP stack.
- **Scope:** the generator (`server/codegen/`) keeps the operations the backend marks `x-clikgate-auth: api_key`. It drops `dashboard_session`, `staff`, `public`, `sdk_key` and `cli` operations. The filter is shared by all languages, so every SDK exposes the same operations.
- **Status:** the hand-written areas (goals, conversions, links, clicks, click IDs, webhooks, the private-mode guard, referrals, privacy, people, installs, codes) are what the docs teach. `api.*` is "advanced".
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

- **The app's installation:** every add-on also exposes the `Clikgate-Installation` header, parsed (section 24.1).
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
  - Nightly live contract tests with a `cg_test_` key.
- **CI matrix:** every supported runtime plus the minimum, on Linux and Windows.
- **Releases:**
  - Tags `server-<lang>-v<semver>`.
  - Trusted publishing or signing per registry.
  - A CycloneDX SBOM per release.
  - `SECURITY.md` with the disclosure address `support@clikgate.com` (trust centre: https://clikgate.com/trust).
- **Versioning:** semantic versioning and a `CHANGELOG.md` per SDK. Deprecations are announced ≥ 6 months ahead. Runtime support is dropped only after that runtime's end of life.
- **Examples:** in `server/<lang>/examples/`, showing capture → save → `goal` → verify webhook.

## 20. Backend facts this contract relies on

These were checked in the backend on 2026-10-26:

- **Goal events:**
  - `POST /v1/goals/events` → `201` new / `200` already received. Re-checked 2026-10-28: the body is `GoalEventInfoResponse` with `status` (`GoalStatus`), `reason`, `goal_kind`, `counted`, `value_ignored`, `event_status` (the conversion state that `status` held before) and `payment` (section 23).
  - `POST /v1/goals/events/batch` → `200 {object: "list", data: [{index, ok, status, goal_event, error}]}` (≤ 500 events).
  - `POST /v1/goals/events/reverse` → `200 goal_event`.
  - Errors are listed in `docs/GOALS.md`.
- **Conversions:** `POST /v1/conversions` returns `201` (new) or `200` (existing `external_id`). `POST /v1/conversions/{id}/reverse` takes `{amount_minor?, reason?, external_id?}`.
- **Links** (re-checked against the built backend, 2026-10-26):
  - `POST /v1/links` → `201`.
  - `PATCH /v1/links/{id}` → `200` link, or `202` `LinkChangeRequestInfoResponse` (two-person approval), or `409 link_locked`. Live links on organisations with link safety can also get `422 https_required` / `422 destination_not_allowlisted`.
  - `warnings[]` on `link` (`LinkWarningResponse {code, message, param}`) includes `no_preview` on create and update when both `og_title` and `og_image_url` are empty.
  - `GET /v1/links/{id}/qr?format=svg|png&size&margin&dark&light`.
- **Clicks:** `GET /v1/clicks/{id}`.
- **Being added:** `GET /v1/server-sdk/config` is coded to the spec shape. Until it is deployed, a 404 triggers the fail-closed path in 12.1.
- **Webhook `link.destination_changed`:** `data.object` is the link; `data` also carries `from`, `to`, `actor {type, id, api_key_prefix, requested_by?, change_request_id?}`, `actor_type` and `api_key_prefix`. SDKs return it as any other event.
- **Webhook `subscription.updated`:** sent when a Growth add-on is activated, set to end at renewal, or kept. `data.object` is the subscription with `add_ons[]` (`key`, `name`, `status`, `amount_minor`, `ends_at`, `remove_at_renewal`); `data` also carries `previous_attributes`, `change` (`add_on.activated` or `add_on.remove_at_renewal`, the second also when "Remove at renewal" is undone: read `add_ons[].remove_at_renewal`) and `add_on_key`. Endpoints subscribe to it like the other `subscription.*` events. Webhook `type` stays a plain string in every SDK, so no type changes; conformance `webhooks.valid.subscription_updated`.
- **Plumbing:**
  - Errors: the envelope above.
  - Idempotency: keys are kept for the backend's idempotency window (see Idempotency above).
  - Request IDs come back as `X-Request-Id`. Rate-limit headers are `RateLimit-Limit` / `-Remaining` / `-Reset` and `Retry-After` on 429.
- **Webhook signatures:** the scheme under Webhooks above.
- **Click IDs:** prefixed ULIDs. The web script cookie is `_cg_<param>`, `path=/`, `SameSite=Lax`, `Secure` on HTTPS (the web script's default lifetime is 7 days; the server SDK default is 30 days).

## 21. Metadata filters and link metadata

- **Wire:** the backend filters by link metadata with one query parameter per key: `?metadata[seller_id]=sel_ada`.
  The backend reads them from the raw query string,
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
  `end_goal_value_minor` (`{"NGN": 1850000}`), the backend's convention. Node and Python type it so; PHP, Java and .NET
  return the JSON as parsed (strings stay strings).

## 22. Payments confirmed by the business's server

The website or app **reports** a payment by
sending a **Payment goal** with `goal()` (`provider` and `reference`, never an amount; the separate
`payment()` methods were removed and their routes). The business's server **confirms** it right after its own verification with
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
  "payment_goals"`: payment confirmations need Starter or above; this plan gate replaced the earlier `sales_tracking`
  feature gate), `422 unknown_provider`, `invalid_status`, `invalid_amount`, `invalid_currency`,
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
  the backend's `docs/payment-helper-vectors.json`. `build-cases.mjs --check` fails when the two differ.

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

## 23. Goal kinds, goal status and the shared enums

Backend contract (final). Every goal is **Standard** or **Payment** (`kind`, set only in the goal's
settings: never in a goal call). `goal()` is the only goal method; there is no `payment()` method in any SDK.

### 23.1 The enums

| Enum | Values (wire) | Node | Python | PHP | Java | .NET |
|---|---|---|---|---|---|---|
| `GoalKind` | `standard`, `payment` | `GoalKind.Payment` (type `'standard' \| 'payment'`) | `GoalKind.PAYMENT` | `GoalKind::Payment` | `GoalKind.PAYMENT` | `GoalKind.PAYMENT` |
| `GoalStatus` | `counted`, `waiting`, `refused`, `received` | `GoalStatus.Counted` | `GoalStatus.COUNTED` | `GoalStatus::Counted` | `GoalStatus.COUNTED` | `GoalStatus.COUNTED` |
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
| `counted` | `status == "counted"` (kept) |
| `value_ignored` | `true` when the value was dropped (browser and app senders of a Payment goal) |
| `event_status` | the conversion state that `status` held before (`attributed`, `unattributed`, `rejected_bot`, …), or null while a Payment goal waits |
| `payment` | for a Payment goal sent by the server: `{confirmation_id, match_status, report_id, provider}`; else null |

- `waiting`, `refused` and `received` are **results**, not errors: `goals.send` returns them, background `goal()`
  doesn't pass them to `on_error`, and none is retried. 4xx errors stay errors (section 5).
- **`received`:** a name that isn't ticked as a goal yet answers `200 {status: "received", reason:
  "not_counted_yet"}`; an archived goal answers `received` with reason `goal_archived` (no longer `410 goal_archived`).
  The event is stored for 30 days, not counted, not metered and not sent to ad networks. Conformance:
  `goals.send.status.received_not_counted_yet` and `goals.background.received_not_counted_yet`.
- **Strict goal names:** with the organisation's "Allow unknown goal names" off, a name with
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


## 24. People: `identifyUser` and goal labels

- **Method** (section 2 casing): Node `identifyUser(params, requestOptions?)`, Python `identify_user(*, click_id,
  installation, app_id, installation_id, customer_id, label, request_options)` (sync and async), PHP
  `identifyUser(array $params, array $requestOptions = [])`, Java `identifyUser(IdentifyUserParams[, RequestOptions])` →
  `PersonIdentified`, .NET `IdentifyUserAsync(IdentifyUserParams, RequestOptions?, CancellationToken)` →
  `PersonIdentified`.
- **Wire:** `POST /v1/people/identify` `{click_id?, app_id?, installation_id?, customer_id?, label?}` (nulls omitted),
  answer `{object: "person_identified", person_id, label_ignored: "plan" | "lower_rank" | null}` returned as is.
- **`installation` argument** (canonical; Node `installation`, Python `installation`, PHP `'installation'`, Java
  `IdentifyUserParams.Builder.installation(String)`, .NET `IdentifyUserParams.Installation`): the raw
  `Clikgate-Installation` header value (24.1). It is parsed with `installations.parse_header`; when valid and
  `installation_id` isn't given, it fills `installation_id`, and `app_id` unless `app_id` is given. A missing or
  invalid value is ignored: never an error, never sent, never logged. The raw value never reaches the wire.
- **Local checks** (before any request, after `installation` is applied): `app_id` without `installation_id`
  (`invalid_request`, param `installation_id`); at least one of `click_id`, the installation, `customer_id`
  (`invalid_request`, param `click_id`). `installation_id` without `app_id` is sent as is: the API finds the app.
- **Several apps:** when the installation ID is active in several of the organisation's apps (same environment, last
  7 days), the API answers `409 installation_in_several_apps` (`param: app_id`), a `ConflictError` (section 5); the
  caller sends `app_id`. The body never names the apps. Without `app_id`, an unknown installation is `404` and one
  inactive for more than 7 days `422 installation_inactive`, as with `app_id`.
- **Guard** (section 12.2): kind `identify` allows `click_id`, `app_id`, `installation_id`, `label`; `customer_id` is
  refused (`private_mode_field_rejected`). Goals allow `label` too. The server SDK config has no labels switch, so the
  API decides (`422 labels_off_in_private_mode`, an `InvalidRequestError`).
- **Goals:** optional `label` (wire `label`) on `goal`, `goals.send` and batch events; `is_first` is unchanged (from the
  server it is what counts a new customer).
- The removed `POST /v1/apps/{app_id}/identify` is gone from the generated layer. Conformance: suite `people` (13
  cases: the original 6, `installation_id` without `app_id`, the header, explicit IDs winning, bad headers ignored,
  the 409, `installations.parse_header` and `installations.from_request`).
- **Path B:** the app sends the `Clikgate-Installation` header (24.1) to its own server with its sign-in request and
  signed-in requests. After the server's own sign-in check succeeds, and at every signed-in app open, the server calls
  `identifyUser` with `installation` (the header) and `customer_id` (and `label`), and skips the call when the header
  is missing or invalid (tracking off). No identity secret or token is needed; the API accepts installations active in
  the last 7 days, and the call satisfies `require_identity_token`. Each SDK's `identifyUser` doc comment and README
  show this path next to path A (section 26), the 409, and link to https://clikgate.com/docs/identify-users.
- **The customer ID never comes from the request.** The header only supplies `app_id` and `installation_id`.
  `customer_id` is always the server's own authenticated user. Every README and the `identifyUser` doc comment say:
  call `identifyUser` only after your own sign-in check succeeds, and never read the customer ID from the request.

### 24.1 The `Clikgate-Installation` header

- **Contract** (produced by the mobile SDKs): header name `Clikgate-Installation`, value `<app_id>:<installation_id>`,
  e.g. `app_01JCK8Z9V7Q4M2N6P8R0S2T4AP:6a1f0c2e-0000-4000-8000-000000000001`. Not a secret.
- **Parsing** (`installations.parse_header(value)`), strict, the same in every SDK:
  1. Not a string, or longer than **128** characters (before trimming) → null.
  2. Trim leading and trailing ASCII whitespace (space, tab, CR, LF, form feed, vertical tab), nothing else.
  3. Match `^(app_[0-9A-Z]{26}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$`: the app ID
     (prefixed ULID, uppercase), exactly one colon, a **lowercase** UUID. Anything else → null.
  4. Never throws, never logs the value, never passes a malformed value on.
- **Result:** an installation with `app_id` and `installation_id` (section 2 casing), or null.
- **`installations.from_request(request)`:** the header from the framework's request (case-insensitive name). Missing,
  invalid, or sent more than once → null. Never throws.

| Canonical | Node | Python | PHP | Java | .NET |
|---|---|---|---|---|---|
| `installations.parse_header(value)` | `parseInstallationHeader(value)` → `{ appId, installationId }` \| `null` | `parse_installation_header(value)` → `Installation(app_id, installation_id)` \| `None` | `Installation::parseHeader($value)` → `?Installation` (`->appId`, `->installationId`) | `Installation.parseHeader(String)` → `Installation` (`getAppId()`, `getInstallationId()`) or `null` | `Installation.ParseHeader(string?)` → `Installation?` (`AppId`, `InstallationId`) |
| `installations.from_request(request)` | `installationFromRequest(req)` | `installation_from_request(request)` | `Installation::fromRequest(ServerRequestInterface)` | `ClikgateInstallations.from(HttpServletRequest)` (servlet modules) | `HttpContext.GetClikgateInstallation()` (`Clikgate.AspNetCore`) |
| header constant | `INSTALLATION_HEADER` | `INSTALLATION_HEADER` | `Installation::HEADER` | `Installation.HEADER` | `Installation.Header` |

- **Framework add-ons** expose it next to the click ID (section 17): Express `req.clikgate.installation`, Fastify
  `request.clikgate.installation`, Next.js `getInstallation(await headers())`, Django `request.clikgate_installation`,
  Flask `g.clikgate_installation`, FastAPI / Starlette `Depends(installation)`, PSR-15 attribute
  `clikgate.installation`, Laravel `$request->clikgateInstallation()`, Spring Boot `@ClikgateInstallation Installation`
  (null when missing or invalid; never fails the request), Servlet `ClikgateInstallations.from(request)`, ASP.NET Core
  `HttpContext.GetClikgateInstallation()`.


## 26. Identity tokens: `createIdentityToken`

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
- **Server only**: `ClikgateServerOnlyError` (code `server_only`; PHP, Java and .NET `ClikgateServerOnlyException`)
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
- **Verification reasons** (backend) the docs list: `expired`, `bad_signature`, `secret_rotated`, `no_secret_set`,
  `not_yet_valid` (issued more than 5 minutes ahead). The SDKs never verify tokens.
- **Version 2: the account date**. An optional `customer_since` (when the person became the
  business's customer) makes a three-part token `signature.issued_at.customer_since`; without it the token is version 1,
  unchanged. Both dates are whole UTC Unix seconds.
  - MAC input: `"v2\n" + utf8_byte_length(cid) + ":" + cid + "\n" + issued_at + "\n" + customer_since`, where `cid` is
    the **canonical** customer ID (section 27: NFC, trimmed). It can never equal a version 1 input (the forgery vectors
    check both directions).
  - Local check: `customer_since` from 631152000 (1990-01-01) to `issued_at + 300`; else `InvalidRequestError`
    `invalid_argument`, param `customer_since`. An ID that is empty after canonicalisation is `invalid_customer_id`.
  - Names (section 2 casing): Node `createIdentityToken(customerId, { customerSince })` (`Date` or Unix seconds);
    Python `create_identity_token(customer_id, customer_since=…)` (`datetime`, `date` = midnight UTC, or Unix seconds;
    also on both clients); PHP and Laravel `['customerSince' => DateTimeInterface|int]`; Java
    `IdentityTokens.create(customerId, appId, Instant)`, `create(customerId, secret, issuedAtSeconds,
    customerSinceSeconds)`, client `createIdentityToken(customerId, appId, Instant)`; .NET
    `IdentityTokens.Create(customerId, appId, DateTimeOffset)`, `Create(customerId, secret, issuedAtSeconds,
    customerSinceSeconds)`, client `CreateIdentityToken(customerId, appId, DateTimeOffset)` (also on `IClikgateClient`).
  - **A missing account date is not an error.** Every SDK's version 2 call accepts "no date" (`undefined`/`null`, `None`,
    a missing option, Java's null `Instant`, .NET's `DateTimeOffset?` null) and then makes a version 1 token, so a
    business can pass its nullable `created_at` column for every customer. It never throws for a missing date.
  - Vectors: `v2`, `v2_invalid_customer_since` and `forgeries` in `identity-token-vectors.json` (the builder's reference
    signer, cross-checked against the backend's `sign_identity_token_v2` when it exists). PHP needs the `intl` extension
    only for non-ASCII customer IDs in version 2 (`ConfigurationException` `intl_required` otherwise).

## 27. Existing customers: account dates and known customers

Clikgate tells people who were already the business's customers before it added Clikgate from new ones (referrals, new
customers). The server SDKs send two kinds of evidence, both refused in private mode.

- **The canonical customer ID**, one form everywhere: Unicode NFC, then trimmed of Unicode White_Space
  characters and U+FEFF at both ends, case kept. Helpers (pure, offline): Node `canonicalCustomerId(id)`,
  `customerIdWarning(id, { allow11DigitIds })`; Python `canonical_customer_id`, `customer_id_warning(id, *,
  allow_11_digit_ids=False)`; PHP `Clikgate\CustomerId::canonical`, `::warning($id, $allow11DigitIds = false)`; Java
  `CustomerIds.canonical`, `CustomerIds.warning(id[, allow11DigitIds])`; .NET `CustomerIds.Canonical`,
  `CustomerIds.Warning(id, allow11DigitIds = false)`. Warnings, first match wins: `empty`; `too_long` (more than 128 code
  points); `looks_like_email` (an `@` with a `.` after the first `@`); `looks_like_national_id` (exactly 11 ASCII digits,
  unless allowed); `looks_like_phone` (after removing spaces and `-`, an optional `+` then 10-15 ASCII digits). Vectors:
  `server/conformance/vectors/customer-id-vectors.json` (`tools/build_customer_id_vectors.py [--check]`), also copied to
  the backend's test fixtures. The SDKs never refuse an ID locally with these: the API decides and answers counts.
- **`identifyUser` account date**: wire `customer_since` (`YYYY-MM-DD`, or an RFC 3339 UTC date-time
  `YYYY-MM-DDTHH:MM:SSZ` made from a date-time value or Unix seconds; strings are passed through when they look like
  either) and `customer_since_replace: true` (sent only when true; lets a wrong date move later, audit-logged). Local
  check: `customer_since` needs `customer_id` (`invalid_request`, param `customer_since`); a malformed value is
  `invalid_argument`. The answer may carry `customer_since_ignored` (`unverified` | `invalid`) and
  `customer_id_warning` (`looks_like_email` | `looks_like_phone` | `looks_like_national_id`). Names: Node
  `customerSince`, `customerSinceReplace`; Python `customer_since`, `customer_since_replace`; PHP `customerSince`,
  `customerSinceReplace`; Java builder `customerSince(Instant | LocalDate)`, `customerSinceReplace(boolean)`, answer
  `getCustomerSinceIgnored()`, `getCustomerIdWarning()`; .NET `CustomerSince` (`DateTimeOffset?`),
  `CustomerSinceReplace`, answer `CustomerSinceIgnored`, `CustomerIdWarning`.
- **Known customers**, scope `people:write`:
  - `import`: `POST /v1/known-customers/import {customers: [{customer_id, customer_since?: "YYYY-MM-DD"}]}`, at most
    10,000 per call → `{accepted, refused, refused_by_reason: {reason: count}}`. The SDK splits any list into batches of
    10,000 in order and sums the answers. A caller's idempotency key gets `-<batch index>` appended when there are
    several batches (one batch keeps it as is). An empty list sends nothing and answers zeros. Dates are sent as the
    UTC day. Names: Node `clikgate.knownCustomers.import(customers)` (`{customerId, customerSince?}`), Python
    `known_customers.import_customers(customers)` (`import` is a keyword; dicts `{"customer_id", "customer_since"?}`;
    sync and async), PHP `$clikgate->knownCustomers->import(iterable)` (`['customerId', 'customerSince'?]`; Laravel
    `Clikgate::knownCustomers()`), Java `knownCustomers().importCustomers(List<KnownCustomer>)` →
    `KnownCustomersImportResult` (`import` is a keyword), .NET `KnownCustomers.ImportAsync(IEnumerable<KnownCustomer>)`.
  - `remove`: `POST /v1/known-customers/remove {customer_id}` (the ID only in the body) → `{removed}`. Node and Python
    and PHP return the answer object; Java `remove(id)` and .NET `RemoveAsync(id)` return the boolean.
- **Private mode**: `customer_since` and `customer_since_replace` are not in the `identify` allow-list, so the
  guard refuses them (`PrivateModeFieldRejectedError`, as the API's `422 private_mode_field_rejected`). Known customers
  are a switched-off feature: with the guard on, `import` and `remove` raise `ConflictError` (PHP, Java, .NET
  `ConflictException`) with code `private_mode_conflict` and no HTTP status, before any request (the API answers
  `409 private_mode_conflict`).
- **Never logged:** customer IDs, account dates and imported rows appear in no log line or error message.
- **Generated layer:** the operations appear in `clikgate.api.*` once the backend's `openapi.json` has them and the
  generator runs (section 16); the hand-written methods above don't wait for that.


## 25. Hashed email and phone for ad network matching

Backend behaviour, checked 2026-11-04: a business
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


## 28. Typed models and referrals: `clikgate.referrals`

Every method in sections 28-32 returns a **typed model**. Customer-owned free-form data stays a map: link
`metadata`, referrer `attributes`, deep-link `deep_link_data`, code `metadata`.

| Language | Models | Optional arguments |
|---|---|---|
| Node | interfaces over the wire JSON (`snake_case` keys, as section 2), exported from the package root | an options object (`{ customerId, displayName }`) |
| Python | `TypedDict`s over the wire JSON (`snake_case` keys), exported from `clikgate` | keyword arguments (`customer_id=...`) |
| PHP | `final` readonly classes in `Clikgate\Model` with camelCase properties (`$referrer->customerId`). They implement `ArrayAccess` (reads the wire keys: `$referrer['customer_user_id']`), `JsonSerializable` and `toArray()` (the wire JSON plus the derived fields) | an array (`['customerId' => …]`) |
| Java | immutable classes with getters (`getCustomerId()`), `getRaw()` | builders |
| .NET | records (`CustomerId`), `Raw` | params records |

- **Same pipeline:** every method uses the hand-written request function: retries (section 6), idempotency keys on POST
  and PATCH (section 7), errors (section 5) and logging. Nothing changes on the wire.
- **Forward compatibility** (section 23.3): unknown fields are kept (Node and Python: the JSON as is; PHP: `toArray()`
  and `ArrayAccess`; Java and .NET: the raw JSON).
- **Typed names:** the wire field `customer_user_id` is the **customer ID** (canonical `customer_id`): Java
  `getCustomerId()`, .NET `CustomerId`, PHP `customerId`. A referral's `reward_snapshot` is `reward`
  (`getReward()`, `Reward`, `->reward`) and its `link.id` is `link_id` (`getLinkId()`, `LinkId`, `->linkId`). Node
  and Python keep the wire keys (`customer_user_id`, `reward_snapshot`, `link`) and **add** the customer ID under the
  typed name on a referrer and on a referral's `referrer` and `referee`: Node `referrer.customerId`,
  `referral.referrer.customerId`, `referral.referee.customerId` (null until the referee is identified); Python
  `customer_id` in the same places. Java `getReferrer().getCustomerId()`, .NET `Referrer.CustomerId`, PHP
  `->referrer->customerId`. These added keys are not part of the canonical conformance results.
- **Reward amounts** (section 8 rules for responses): a reward side's `amount_minor` (integer, minor units) stays as on
  the wire. When it has both `amount_minor` and `currency`, the SDK adds **`amount`**, the same amount in normal units
  as a decimal string with exactly the currency's ISO 4217 exponent of fraction digits: `50000 NGN` → `"500.00"`,
  `1500 JPY` → `"1500"`, `12345 KWD` → `"12.345"`. The currency is matched case-insensitively. Exponents other than 2:
  0 for `BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF`, 3 for `BHD IQD JOD KWD LYD OMR TND`, 4 for
  `CLF UYW` (the backend's ISO 4217 list); every other code has 2. No float is ever involved. Java and .NET expose
  `amount` as `BigDecimal` / `decimal` with that scale; their runners serialise it as the string above.

### 28.1 Methods

| Canonical | HTTP | Returns |
|---|---|---|
| `referrals.get_or_create_referrer(program_id, {customer_id, display_name?, external_code?})` | `POST /v1/referral-programs/{program_id}/referrers` `{customer_user_id, display_name?, external_code?}` | `Referrer` with **`created`**: `true` when the API answered `201`, `false` for `200` |
| `referrals.get_referrer(referrer_id)` | `GET /v1/referrers/{id}` | `Referrer` |
| `referrals.find_referrer(program_id, {customer_id} \| {code})` | `GET …/referrers/by-user/{customer_id}` or `GET …/referrers/by-code/{code}` | `Referrer`, or **null on 404**; every other error throws |
| `referrals.get(referral_id)` | `GET /v1/referrals/{id}` | `Referral` |
| `referrals.list({program_id?, referrer_id?, referee_customer_id?, status?, from?, to?, limit?})` | `GET /v1/referrals` | an auto-paging iterator of `Referral` (section 11 pagination) |
| `referrals.list_page(same)` | `GET /v1/referrals` | one page `{object, data: Referral[], has_more, next_cursor}` |
| `referrals.qualify(referral_id, {reason})` / `referrals.disqualify(referral_id, {reason})` | `POST /v1/referrals/{id}/override` `{action: "qualify" \| "disqualify", reason}` | `Referral` |
| `referrals.complete_step(referral_id, {goal, occurred_at, value?, currency?})` | `POST /v1/referrals/{id}/steps` | `Referral` |
| `referrals.import_referrers(program_id, rows[{customer_id, external_code?, display_name?}])` | `POST …/referrers/import` `{referrers: [{customer_user_id, …}]}` | `Job[]`, one per batch |
| `referrals.block_referrer(referrer_id, {reason?})` | `POST /v1/referrers/{id}/block` (`{reason}` or `{}`) | `Referrer` |
| `referrals.unblock_referrer(referrer_id)` | `POST /v1/referrers/{id}/unblock` (no body) | `Referrer` |
| `referrals.update_referrer(referrer_id, {display_name?, attributes?})` | `PATCH /v1/referrers/{id}` | `Referrer` |

| Language | Example |
|---|---|
| Node | `await clikgate.referrals.getOrCreateReferrer(programId, { customerId: user.id, displayName: user.name })` |
| Python | `clikgate.referrals.get_or_create_referrer(program_id, customer_id=user.id, display_name=user.name)` (also async) |
| PHP | `$clikgate->referrals->getOrCreateReferrer($programId, ['customerId' => $user->id, 'displayName' => $user->name])` |
| Laravel | `Clikgate::referrals()->getOrCreateReferrer(...)` |
| Java | `clikgate.referrals().getOrCreateReferrer(programId, GetOrCreateReferrerParams.builder().customerId(id).build())` |
| .NET | `await clikgate.Referrals.GetOrCreateReferrerAsync(programId, new GetOrCreateReferrerParams { CustomerId = id })` |

- **Java and .NET parameter types:** `GetOrCreateReferrerParams`, `UpdateReferrerParams` (section 28),
  `CreatePrivacyRequestParams` (section 30) and `RedeemCodeParams` (section 32). The other methods take plain
  arguments.

- **Arguments:** `customer_id` is sent as `customer_user_id` everywhere (the referrer rows of `import_referrers`, the
  `referee_customer_id` filter as `referee_customer_user_id`). Unset optional fields are omitted (section 4).
- **Local checks** (`InvalidRequestError`, `http_status` null, nothing sent): an empty `program_id`, `referrer_id`,
  `referral_id` or `customer_id` is `invalid_argument` (param the argument). `find_referrer` needs exactly one of
  `customer_id` and `code` (`invalid_argument`, param `customer_id`). `complete_step` formats `value` as section 8
  (`invalid_value`).
- **`complete_step`:** `occurred_at` is **required**, because the API requires it: missing (null, absent or an empty
  string) it is a local `invalid_argument` with param `occurred_at`, and nothing is sent. It takes a datetime or an RFC
  3339 string, formatted as section 4. `goal` follows the goal key rule of the API (`^[a-z][a-z0-9_]{1,39}$`, checked
  by the server).
- **`list` dates:** `from` and `to` take a datetime or an RFC 3339 string, sent as section 4 query values.
- **`import_referrers` batches:** rows are sent in order in batches of **1000** (the API's limit), one request per
  batch, each with its own `Idempotency-Key` (a caller's key gets `-<batch index>` appended when there are several
  batches; one batch keeps it as is). The result is the list of `Job`s in order. An empty list sends nothing and
  returns `[]`. A failing batch throws; earlier batches stay submitted.
- **Never logged:** customer IDs, display names and attributes.

### 28.2 Models

**`Referrer`** (`object: "referrer"`): `id`, `program_id`, `customer_user_id` (the customer ID), `display_name`, `code`,
`external_code`, `link_id`, `url` (the code URL, else the short link), `short_url`, `status` (`active` \| `blocked`),
`blocked_reason`, `blocked_at`, `stats` (**`ReferrerStats`**: `clicks`, `installs`, `signups`, `in_progress`,
`qualified`, `disqualified`, `rejected`, and `referee_uninstall_rate_7d` (0 to 1, or null; absent until first
refreshed)), `attributes` (map), `leaderboard_opt_out`, `quality_score`, `quality_band`, `last_activity_at`,
`created_at`, `updated_at`, `livemode`; plus `created` on `get_or_create_referrer` results.

**`Referral`** (`object: "referral"`): `id`, `program_id`, `referrer_id`, `status`, `source`, `match_type`,
`current_step`, `steps_completed` (`[{index, goal?, identify?, completed_at, source_id?}]`), `step_deadline_at`,
`hold_until`, `qualified_at`, `disqualified_at`, `rejected_at`, `reason`, `reason_detail`, `reason_message`,
`fraud_flags`, `referee_uninstalled_after_qualification`, `program` `{id, name}`, `referrer` `{id, customer_user_id,
code}`, `referee` `{install_id, installation_id, customer_user_id}`, `link` (`{id}` or null), `click_id`,
`reward_snapshot` (**`RewardInfo`**, absent or null when the program had no reward information), `history?` (`[{from_status,
to_status, reason, actor, created_at}]`, when the API includes it), `created_at`, `updated_at`, `livemode`.

**`RewardInfo`**: `referrer` and `referee` (each a **`RewardSide`** `{amount_minor?, currency?, description?,
amount?}`, absent when not set) and `note?`. Clikgate never pays rewards; this is for your records.

**`Job`** (`object: "job"`): `id`, `type`, `status`, `total`, `succeeded`, `failed`, `results` (`[{index?, ok?,
referrer_id?, link_id?, created?, url?, expires_at?, rows?, files?, run_id?, table?, deleted?, error?: {type, code, message?,
param?}}]`, only the keys that apply), `created_at`, `finished_at`, `livemode`.

### 28.3 Conformance

Suite `referrals`. Results are the wire objects plus `created` and `amount`:

| `call` | `args` | Canonical result |
|---|---|---|
| `referrals.get_or_create_referrer` | `program_id`, `customer_id`, `display_name?`, `external_code?` | the referrer + `created` |
| `referrals.get_referrer` | `id` | the referrer |
| `referrals.find_referrer` | `program_id`, `customer_id?`, `code?` | the referrer or `null` |
| `referrals.get` | `id` | the referral |
| `referrals.list` | `params?` (`program_id`, `referrer_id`, `referee_customer_id`, `status`, `from`, `to`, `limit`), `max_items?` | `{"items": [referral, …]}` |
| `referrals.list_page` | `params?` | the page |
| `referrals.qualify`, `referrals.disqualify` | `id`, `reason` | the referral |
| `referrals.complete_step` | `id`, `goal`, `occurred_at`, `value?`, `currency?` | the referral |
| `referrals.import_referrers` | `program_id`, `rows` (`[{customer_id, external_code?, display_name?}]`) | the list of jobs |
| `referrals.block_referrer` | `id`, `reason?` | the referrer |
| `referrals.unblock_referrer` | `id` | the referrer |
| `referrals.update_referrer` | `id`, `display_name?`, `attributes?` | the referrer |

## 29. Typed webhook events

`webhooks.verify` / `verify_any` (section 14, with and without a client) return a **`WebhookEvent`**: `id`, `type`,
`api_version`, `created_at`, `organization_id`, `livemode` and `data` (the raw map, unchanged, so existing code keeps
working). It gains typed accessors that read `data.object`:

| Canonical | Event types | Gives |
|---|---|---|
| `as_referral()` | `referral.*` | `Referral` (section 28.2, with reward amounts) |
| `as_referrer()` | `referrer.*` | `Referrer` |
| `as_goal_event()` | `goal.completed`, `goal.reversed` (`goal.*`) | the goal event as webhooks show it: `object`, `id`, `goal`, `value`, `value_minor`, `currency`, `first_for_click`, `is_first_customer`, `link` `{id}`, `campaign` `{id}`, `clicked_at`, `occurred_at`, `status` (the attribution state), `received_as`, `goal_group` `{id, name}`, `reference` (absent in private mode), `person` `{id, label}` and `backfilled` (`goal.completed`) |
| `as_install()` | `install.*` | `Install` (section 32) |
| `as_payment()` | `payment.*` | `PaymentReport`: the payment report (`object: "payment_report"`, `id`, `provider`, `reference`, `source`, `goal`, `status`, `status_reason`, `click_id`, `installation_id`, `link_id`, `channel`, `confirmation`, `counted`, `goal_event_id`, `refunded_amount_minor`, `occurred_at`, `created_at`, `decided_at`, `expires_at`, `livemode`, …) |
| `as_device_change()` | `person.device_changed` | `DeviceChange` (`object: "device_change"`): `id` (`{device_change_id}:{kind}`), `device_change_id`, `person_id`, `customer_id`, `app_id`, `kind` (`switch` \| `second_device`), `from` and `to` (each `{platform, device_model}`; PHP `->from` / `->to`, Java `getFrom()` / `getTo()`, .NET `From` / `To`), `from_last_seen_at`, `to_first_open_at`, `gap_days` (null for a second device), `livemode` |
| `as_conversion()` | `conversion.*` | `Conversion` (`id`, `external_id`, `status`, `type`, `amount_minor`, `currency`, `reversed_amount_minor`, `click_id`, `link`, `campaign`, `metadata`, `goal`, `value`, `occurred_at`, `received_at`, `created_at`, `livemode`, …) |

- **Matching** is by the type's family prefix (`referral.`, `referrer.`, `goal.`, `install.`, `payment.`,
  `conversion.`), so a newer type in a family (one this SDK release doesn't list) still gives the object. `app.reengaged`
  is not `install.*`. `as_device_change()` matches the one type `person.device_changed` (its object is a device change,
  not a person).
- **A mismatch** (another family, or `data.object` not an object) gives **null** in Node, Python and PHP (`?Referral`,
  `Referral | null`, `Optional[Referral]`). Java and .NET also return `null` (`@Nullable`, nullable reference types), so
  the same `if` works everywhere and nothing throws for an event you didn't expect.
- **Names** (section 2 casing): Node `event.asReferral()`; Python `event.as_referral()`; PHP `$event->asReferral()`;
  Java `event.asReferral()`; .NET `event.AsReferral()`. The same for the other six.
- **Shape:** Node returns a plain event object with the accessors as non-enumerable methods (so `JSON.stringify(event)` is
  unchanged). Python returns a `WebhookEvent`, a `dict` subclass (so `event["type"]` keeps working) with the accessors
  and read-only attributes `id`, `type`, `api_version`, `created_at`, `organization_id`, `livemode`, `data`. PHP
  returns `Clikgate\Model\WebhookEvent` with readonly properties (`->id`, `->type`, `->apiVersion`, …), `ArrayAccess`
  for the wire keys (`$event['type']`, `$event['data']['object']` keep working) and `toArray()`; the docs use
  `$event->type`.
- **Discriminated union** (Node and Python): `event.typed()` returns the same event typed as `TypedWebhookEvent`, a
  union discriminated by `type` whose `data.object` is typed per family (Node: `const e = event.typed(); if (e.type ===
  EventType.ReferralQualified) e.data.object.referrer`; Python: `e = event.typed()` narrowed by `e["type"] ==
  "referral.qualified"`). The union describes the raw `data`; the accessors add the derived fields (`amount`).

### 29.1 `EventType`

Every webhook event type the API sends, as **plain string constants** holding the wire string (`referral.qualified`),
never language enums that need unwrapping, so `event.type === EventType.ReferralQualified` (and the same comparison in
every language) is true for a `referral.qualified` event:

| Language | Constant | Kind |
|---|---|---|
| Node | `EventType.ReferralQualified` | PascalCase keys on a `const` object with string values; type `EventTypeValue` |
| Python | `EventType.REFERRAL_QUALIFIED` | a `str`-valued enum whose members compare equal to the string (`EventType.REFERRAL_QUALIFIED == "referral.qualified"`) |
| PHP | `EventType::ReferralQualified` | class constants holding strings (`final class Clikgate\Enum\EventType`; `EventType::all()` lists them) |
| Java | `EventType.REFERRAL_QUALIFIED` | `public static final String` |
| .NET | `EventType.REFERRAL_QUALIFIED` | `const string` |

 Names are the type
upper-cased with `.` and `_` as word breaks (`link.stats.hourly` → `LINK_STATS_HOURLY` / `LinkStatsHourly`). `type`
itself stays a plain string (PHP `$event->type`, Python `event.type` and `event["type"]`), so an event type added later
is never an error.

The list (97 types; `build-cases.mjs` fails when it differs from the `webhooks` of the vendored public OpenAPI): `ab_test.likely_winner`, `alert.resolved`, `alert.triggered`, `app.push_credentials_invalid`,
`app.reengaged`, `app_banner.paused`, `app_banner.published`, `campaign.paused`, `campaign.resumed`,
`challenge.cancelled`, `challenge.ended`, `challenge.finalized`, `challenge.scheduled`, `challenge.started`,
`click.created`, `code.redeemed`, `conversion.attributed`, `conversion.reversed`, `conversion.unattributed`,
`credit_note.issued`, `domain.group_changed`, `domain.settings_updated`, `domain.status_changed`,
`fraud.install_flagged`, `funnel.stuck`, `goal.completed`, `goal.reversed`, `identity.duplicate_detected`,
`install.attributed`, `install.attribution_updated`, `install.organic`, `install.uninstall_reverted`,
`install.uninstalled`, `invoice.issued`, `invoice.paid`, `invoice.voided`, `job.completed`,
`leaderboard.period_closed`, `leaderboard.period_finalized`, `leaderboard.rank_changed`, `leaderboard.target_reached`,
`leaderboard.target_revoked`, `link.archived`, `link.created`, `link.destination_changed`, `link.expired`,
`link.flagged`, `link.paused`, `link.resumed`, `link.stats.hourly`, `link.updated`, `organization.deleted`,
`organization.feature_changed`, `organization.feature_data_purged`, `partner.approved`, `partner_earning.approved`,
`partner_payout.paid`, `partner_reward.applied`, `partner_reward.approved`, `partner_reward.removed`,
`partner_reward.reversed`, `payment.not_confirmed`, `payment.refunded`, `payment.rejected`, `payment.verified`,
`person.device_changed`, `privacy.request_completed`, `receipt.issued`, `referral.created`, `referral.disqualified`,
`referral.holding`, `referral.qualified`, `referral.referee_uninstalled`, `referral.rejected`,
`referral.step_completed`, `referrer.blocked`, `referrer.created`, `referrer.quality_changed`, `referrer.unblocked`,
`sale.matched`, `sale.refunded`, `skan.postback_received`, `subscription.activated`, `subscription.cancelled`,
`subscription.changed`, `subscription.expired`, `subscription.grace_started`, `subscription.renewed`,
`subscription.trial_converted`, `subscription.trial_ended`, `subscription.trial_extended`, `subscription.trial_started`,
`subscription.updated`, `usage.threshold_reached`, `webhook.test`, `webhook_endpoint.disabled`,
`whatsapp.conversation_attributed`.

### 29.2 Conformance

Suite `webhook_events`:

| `call` | `args` | Canonical result |
|---|---|---|
| `webhooks.typed` | the `webhooks.verify` args + `as` (`referral` \| `referrer` \| `goal_event` \| `install` \| `payment` \| `conversion` \| `device_change`) | the typed object as wire JSON (with `amount`), or `null` on a mismatch |
| `webhooks.event_types` | — | `{"value": [every EventType wire string, sorted]}` |

## 30. Privacy requests: `clikgate.privacy`

| Canonical | HTTP | Returns |
|---|---|---|
| `privacy.create_request({type, subject_type, subject_id, app_id?})` | `POST /v1/privacy/requests` | `PrivacyRequest` (`202`); Java and .NET take `CreatePrivacyRequestParams` |
| `privacy.get_request(request_id)` | `GET /v1/privacy/requests/{id}` | `PrivacyRequest` |

- `type`: `access` \| `export` \| `delete` \| `erasure`. `subject_type`: `installation` \| `customer_user` \| `email` \|
  `phone` \| `person` \| `click`. The SDK sends them as given (a typed language offers the values as a string union or
  constants); the API validates.
- **`PrivacyRequest`** (`object: "privacy_request"`): `id`, `app_id`, `type`, `subject_type`, `status`, `result` (null
  until completed; an export's `{download_url, expires_at, installs, goal_name_events}`, or an erasure's counts per
  kind), `error`, `created_at`, `completed_at`, `livemode`.
- **Never logged:** the subject ID.
- Conformance suite `privacy`: `privacy.create_request` (`type`, `subject_type`, `subject_id`, `app_id?`) and
  `privacy.get_request` (`id`), each giving the request.

## 31. Links: typed inputs, the full model and more methods

- **Typed inputs:** `LinkCreateParams` (the API's `AddLinkSchema`) and `LinkUpdateParams` (`UpdateLinkSchema`). Node
  exports them as types (aliases of the generated ones); Python as `TypedDict`s taken as the first positional argument
  (`clikgate.links.create({"destination_url": …})`); PHP as array shapes. The existing map inputs keep working (Node
  `Record<string, unknown>` overloads, Python keyword arguments, PHP arrays, Java and .NET map overloads).
- **`Link`** has every `LinkInfoResponse` field (`urls`, `domain_group_id`, `click_id_param`, `utm_template`,
  `attribution_window_days`, `external_reference`, `campaign_id`, `end_goal_key`, `og_description`, `expires_at`,
  `paused_reason`, `kind`, `app_ids`, `deep_link_path`, `deep_link_data`, `app_behavior`, `ios_interstitial`,
  `referral_program_id`, `referrer_id`, `locked`, `locked_by`, `locked_at`, `open_in_app`, …). Existing fields and
  getters are unchanged.
- **PHP** link methods return `Clikgate\Model\Link` (and `LinkUpdateResult`, `LinkChangeRequest`, `LinkPage`) instead
  of arrays. They implement `ArrayAccess`, so `$link['short_url']` and `$result['change_request']['id']` keep working.

| Canonical | HTTP | Returns |
|---|---|---|
| `links.archive(id)` | `DELETE /v1/links/{id}` | `Link` (status `archived`) |
| `links.get_by_reference(reference)` | `GET /v1/links/by-reference/{reference}` | `Link` |
| `links.pause(id)` | `POST /v1/links/{id}/pause` (no body) | `Link` |
| `links.resume(id)` | `POST /v1/links/{id}/resume` (no body) | `Link` |

Conformance suite `links_more`: `links.archive` / `links.pause` / `links.resume` (`id`) and `links.get_by_reference`
(`reference`), each giving the link.

## 32. People, installs and codes

| Canonical | HTTP | Returns |
|---|---|---|
| `people.get(person_id)` | `GET /v1/people/{id}` | `Person` |
| `people.search(q)` | `POST /v1/people/search` `{q, cursor?}` | an auto-paging iterator of `PersonSummary` |
| `people.search_page(q, {cursor?, limit?})` | `POST /v1/people/search` `{q, cursor?, limit?}` | one page `{object, data: PersonSummary[], has_more, next_cursor}` |
| `people.set_label(person_id, label)` | `PATCH /v1/people/{id}` `{label}` | `Person` |
| `installs.get_by_customer(customer_id, {app_id?})` | `GET /v1/installs/by-customer-user/{customer_id}?app_id=` | `Install` |
| `installs.get_by_installation(installation_id, {app_id?})` | `GET /v1/installs/by-installation/{installation_id}?app_id=` | `Install` |
| `codes.redeem({external_id, code, channel, app_id?, occurred_at?, metadata?, subject?, agent_id?, location?})` | `POST /v1/codes/redeem` | `CodeRedemption` (`201`) |

- **`people.search` pages** use the body's `cursor` (not `starting_after`): the iterator sends `cursor = next_cursor`
  and stops when `has_more` is false or `next_cursor` is null. The search text goes in the body, never in the URL, and
  is never logged. Each page is a POST with its own idempotency key.
- **`app_id`** for installs: the API currently requires it (`422` otherwise). The SDK sends it when given and lets the
  API decide when it isn't.
- **`codes.redeem`:** `channel` is `ussd`, `sms_keyword`, `agent`, `pos`, `in_store`, `call_center`, `event`, `print`,
  `radio` or `other` (sent as given); `occurred_at` is formatted as section 4; `metadata` is a free-form map;
  `subject` (`{type, id?}`, the redeeming subject), `agent_id` (Node and PHP `agentId`) and `location` (`{country?,
  region?, city?, store_id?}`) are sent as given when present. Java and .NET take them on `RedeemCodeParams`.
- **.NET** people methods: `People.GetAsync`, `People.SearchAsync` (an `IAsyncEnumerable<PersonSummary>`),
  `People.SearchPageAsync` and `People.SetLabelAsync`.
- **`Person`** (`object: "person"`): `id`, `label`, `label_source`, `label_updated_at`, `customer_user_id`,
  `customer_user_id_hint`, `click_id`, `merged_into`, `created_at`, `last_seen_at`, `links`, `label_history`,
  `timeline`, `can_unmerge`, `progress?`, `livemode`. **`PersonSummary`**: `id`, `label`, `click_id`,
  `customer_user_id`, `last_seen_at`, `goals`, `goal_value_minor` (map of currency to minor units), `matched_on`,
  `app?`, `joined_via?`, `referrer?`, `referred_by?`, `livemode`.
- **`Install`** (`object: "install"`): the API's install (`id`, `app_id`, `installation_id`, `platform`,
  `first_open_at`, `attribution_status`, `match_type`, `click_id`, `link`, `customer_user_id`, `uninstall_status`,
  `person`, `livemode`, …).
- **`CodeRedemption`** (`object: "code_redemption"`): `offline_touch_id`, `code` `{code, kind, link_id, campaign_id,
  referrer_id, program_id}`, `referral` (a `Referral`, or null), `linked`, `referral_error` (`{code, message}` or
  null), `livemode`.
- Conformance suite `people_installs_codes`: `people.get` (`id`), `people.set_label` (`id`, `label`), `people.search`
  (`q`, `max_items?`; `{"items": […]}`), `people.search_page` (`q`, `cursor?`, `limit?`), `installs.get_by_customer`
  (`customer_id`, `app_id?`), `installs.get_by_installation` (`installation_id`, `app_id?`), `codes.redeem` (the fields
  above, `agent_id` in snake case).
