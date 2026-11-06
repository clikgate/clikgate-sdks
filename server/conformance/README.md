# Server SDK conformance suite

Language-neutral cases (`cases/*.json`) and a local mock server that **judges** them. Every server
SDK (Node, Python, PHP, Java, .NET) has a thin runner that executes the cases' steps with its own
client and reports what happened. The mock server compares the result with the expectations, so the
matching rules live in one place (`mock-server/judge.mjs`).

**A case that passes in one SDK must pass in all five.** The only exceptions are cases with a
`languages` list. Those cover language-specific money types (SPEC section 8).

```
conformance/
  cases/*.json            the cases (generated; do not edit by hand)
  tools/build-cases.mjs   the authoring source: edit, then run it (also computes hashes and HMACs)
  mock-server/server.mjs  the mock + judge (Node 18+, zero dependencies)
  mock-server/judge.mjs   matching rules
  schema/case.schema.json JSON Schema of a case file
  vectors/payment-helper-vectors.json  copy of clikgate_api/docs/payment-helper-vectors.json (change 11 helper vectors; --check fails on drift)
```

Commands:

```bash
node server/conformance/tools/build-cases.mjs           # regenerate cases/*.json after editing the builder
node server/conformance/tools/build-cases.mjs --check   # CI: fail if cases/*.json are stale
node server/conformance/mock-server/server.mjs --port 0 # start the mock (prints CLIKGATE_MOCK_READY {...})
```

The Node runner is `server/node/test/conformance/runner.ts` (`npm run test:conformance`). Use it as
the reference when writing another runner.

---

## Runner protocol

A runner MUST:

1. **Clear the environment.** Unset `CLIKGATE_API_KEY`, `CLIKGATE_BASE_URL`, `HTTPS_PROXY`, `HTTP_PROXY` (and their lowercase forms) in its own process before constructing any client.
2. **Start the mock.** Run `node <repo>/server/conformance/mock-server/server.mjs --port 0`.
   - Read stdout until a line `CLIKGATE_MOCK_READY {"port":<n>,"cases":<total>}` appears.
   - The base URL is `http://127.0.0.1:<n>`.
   - Node 18+ must be on the PATH. CI installs it in every language job.
3. **List the cases.** `GET /__control/cases?language=<lang>` → `{"cases": [RunnerCase, …]}`. `<lang>` is `node`, `python`, `php`, `java` or `dotnet`. The list already excludes cases whose `languages` doesn't include `<lang>`.
4. **For each case, in order:**
   1. `POST /__control/start` with `{"case_id": "<id>"}`. This resets the mock, loads the case's scripted responses and returns the RunnerCase again.
   2. **Construct a client** from `client` (below) with the test seams (SPEC section 18).
      - **Fake clock:** `now()` returns a variable that starts at `now_ms`. `sleep(ms)` appends `ms` to a list and returns at once, without real waiting.
      - **Random source:** returns `random[i % len]` for the i-th draw.
      - **Capturing logger:** for each `warn`, record the warning **code**. For every log line, record the full text.
      - **`on_error` callback:** records each call.
      - **Shutdown hooks:** off.

      If construction throws, skip the steps and report `construct_error`.
   3. **Execute `steps` in order** (vocabulary below). For each step, record `{"result": <canonical JSON>}` or `{"error": <ErrorOutcome>}`. A step that returns nothing records `{"result": null}`.
   4. `POST /__control/finish` with the Outcome (below). The answer is `{"case_id", "ok": bool, "failures": [string, …]}`.
   5. Close the client (flush timeout ≤ 1 s) **after** `finish`.
5. **Report.** Print each failing case with its failures, then a summary line `conformance (<lang>): P passed, F failed, T total`. Exit non-zero if any case failed or none ran.
6. **Stop the mock.** Kill the mock process, or `POST /__control/shutdown`.

The mock serves one case at a time. Run cases **sequentially**.

### RunnerCase (what the mock sends)

```json
{
  "id": "retries.503_then_success",
  "suite": "retries",
  "description": "…",
  "languages": null,
  "client": {
    "api_key": "cg_test_conformance0000000000",
    "base_url": "http://127.0.0.1:53121",
    "timeout_ms": 2000,
    "max_retries": 3,
    "send_mode": "sync",
    "private_mode": false,
    "click_id_param": null,
    "batch_size": 100,
    "flush_interval_ms": 3600000,
    "max_queue_size": 10000,
    "shutdown_hooks": false
  },
  "random": [0.5],
  "now_ms": 1793016000000,
  "steps": [{"call": "goals.send", "args": {"key": "account_opened", "reference": "APP-55231", "click_id": "clk_…", "value": "2000000"}}]
}
```

**Client fields** (map to your language's option names, SPEC section 3):

- `api_key: null` means "not given". Construction MUST then fail with `ConfigurationError missing_api_key`, because the environment was cleared.
- `click_id_param: null` means "not given".
- `private_mode` is `true`, `false` or `"auto"`.
- Durations are milliseconds. Convert them to your language's unit.
- `base_url` is always set. Use it as given, even when it is invalid on purpose (configuration-error cases) or has a trailing `/`.

### Argument encodings

Step `args` are JSON. These single-key objects stand for native values:

| Encoding | Node | Python | PHP | Java | .NET |
|---|---|---|---|---|---|
| `{"$decimal": "1500.50"}` | the string | `Decimal("1500.50")` | the string | `new BigDecimal("1500.50")` | `decimal.Parse("1500.50", NumberStyles.Float, CultureInfo.InvariantCulture)` |
| `{"$float": 0.1}` (also `"NaN"`, `"Infinity"`) | `number` | `float` | `float` | n/a | n/a |
| `{"$bigint": "9007199254740993"}` | `BigInt` | `int` | `int` (64-bit) | `long` | n/a |
| `{"$datetime": "2026-10-23T09:12:00Z"}` | `Date` | aware `datetime` (UTC) | `DateTimeImmutable` | `Instant` / `OffsetDateTime` | `DateTimeOffset` |
| `{"$bytes_base64": "…"}` | `Buffer` | `bytes` | binary string | `byte[]` | `byte[]` |

- **Gateway responses** (`payments.*` `response`) are passed as your helper's input type with numbers unchanged: a JSON `1500.25` must reach the helper as that exact decimal (SPEC 22.5).
- **Plain JSON values:**
  - A JSON integer is your language's integer.
  - A JSON string is a string. For a money `value` in Java and .NET, convert it to `BigDecimal`/`decimal` from the string.
  - Objects are maps.
- **`null` arguments** are passed as null (`metadata: null` must behave as "unset").

### Step vocabulary

Result shapes are canonical JSON, the wire objects with `snake_case` keys. Typed SDKs serialise their models back to wire JSON.

| `call` | `args` | Canonical result |
|---|---|---|
| `client.mode` | — | `{"value": "live" \| "test"}` |
| `goal` | `key` + goal options (`reference`, `click_id`, `code`, `value`, `currency`, `is_first`, `occurred_at`, `metadata`, `consent`, `label`, `kept_by`, `browser_engine`, `platform`, `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits`, `extra`) | `null` (never an error) |
| `goals.send` | as `goal` (+ optional `idempotency_key`) | the goal event |
| `goals.send_batch` | `events`: list of `{goal, …options}` | the batch response |
| `goals.reverse` | `key`, `reference`, `value?`, `reason?` | the goal event |
| `flush` | `timeout_ms?` (default 10 000) | `{"value": bool}` |
| `close` | `timeout_ms?` | `{"value": bool}` |
| `advance_clock` | `ms` | `null` (add `ms` to the fake clock) |
| `config.get` | — | the config object (or `null`) |
| `conversions.create` | `params` (wire fields), `idempotency_key?` | the conversion |
| `conversions.reverse` | `id`, `params?` | the conversion |
| `links.create` | `params`, `idempotency_key?` | the link |
| `links.get` | `id` | the link |
| `links.update` | `id`, `params` | `{"applied", "link", "change_request", "warnings"}` |
| `links.list` | `params?`, `max_items?` | `{"items": [link, …]}` (iterate lazily; stop after `max_items`) |
| `links.list_page` | `params?` | the page `{object, data, has_more, next_cursor}` |
| `links.qr` | `id`, `format?`, `size?`, … | `{"content_type": string, "bytes_length": int}` |
| `clicks.get` | `id` | the click |
| `webhooks.verify` | `raw_body` (string or `$bytes_base64`), `header` (string or null), `secret`, `tolerance`, `now` (unix s) | the event |
| `webhooks.verify_any` | as above with `secrets` | the event |
| `click_ids.is_valid` | `id` (any JSON) | `{"value": bool}` |
| `click_ids.from_request` | `request: {url, headers}`. Build your framework-neutral request: `url` may be a path; header names are in any case | `{"value": id \| null}` |
| `click_ids.cookie_header` | `id`, `days?`, `secure?`, `domain?` | `{"value": "<Set-Cookie value>"}` |
| `click_ids.persist` | `id`, `secure?`, `days?`, `domain?`, `existing_set_cookie: [..]` (on a fake response that already carries these) | `{"set_cookie": [all Set-Cookie values, in order]}` |
| `click_ids.from_payment_metadata` | `payload` (any JSON) | `{"value": id \| null}` |
| `click_ids.context` (change 16) | `request: {url, headers}` | `{"click_id": id \| null, "kept_by": string \| null, "browser_engine": string, "platform": string}` (SPEC 13.1) |
| `click_ids.keep` (change 16) | `request: {method, url, headers, body}` (body a string), `days?`, `secure?`, `domain?`. Call the SDK's keep handler (`click_ids.keep_route()` or the framework equivalent) on a native request built from these; `click_id_param` comes from `client` | `{"status": int, "cache_control": "<Cache-Control>", "set_cookie": [all Set-Cookie values, in order], "body": "<response body, \"\" when empty>", "location": <Location header or null>}`, plus `"allow"` when the response has an `Allow` header |
| `hash_for_ads` (change 19) | `email?`, `phone?` (strings; absent = not given). Call the SDK's pure helper (SPEC 25) | the helper's fields in wire names: `{"hashed_email"?, "hashed_phone_e164"?, "hashed_phone_digits"?}` (only those given) |
| `money.format` | `value` | `{"value": "<wire string>"}`. If your formatter has no logger, record `inexact_number` when it signals inexactness |
| `payments.confirm` | the SPEC 22.2 fields in `snake_case` (`provider`, `reference`, `status`, `amount`, `amount_minor`, `currency`, `occurred_at`, `aliases`, `click_id`, `goal`, `test`, `extra`) + `idempotency_key?` | the `payment_confirmation` |
| `payments.from` | `gateway` (`paystack` \| `flutterwave` \| `monnify` \| `stripe`), `response` (any JSON), `goal?`, `click_id?`. Call the matching `from_*` helper | the confirmation, or `null` |
| `payments.build` | as `payments.from`. Call the matching pure `build_from_*` | `{"value": body \| null}` (exact) |

### ErrorOutcome

```json
{"class": "RateLimitError", "code": "rate_limit_exceeded", "http_status": 429, "param": null, "request_id": "req_…",
 "type": "rate_limited", "retry_after": 7, "field": null, "index": null,
 "allowed": null, "doc_url": null, "required_plan": null, "limit": null, "message": "…"}
```

- **`class`** is the **canonical** (Node) class name: `PHP RateLimitException` → `RateLimitError`; `ClikgateTimeoutException` → `TimeoutError`; Python's built-in `TypeError` → `TypeError`.
- **Absent fields:** report fields your error doesn't have as `null`. The judge treats a missing field as `null`.

### Outcome (what the runner sends to `/finish`)

```json
{
  "case_id": "…",
  "language": "python",
  "construct_error": null,
  "steps": [{"result": {…}}, {"error": {…}}],
  "sleeps_ms": [250, 500],
  "warnings": ["inexact_number"],
  "logs": ["every log line, as text"],
  "on_error": [{…ErrorOutcome, "events": [{"goal": "…", "reference": "…"}], "dropped": true, "operation": "goal"}]
}
```

### What the judge checks

- **Default checks on every HTTP request** (skipped only if a case sets `skip_default_header_checks`):
  - `Authorization: Bearer <api_key>`.
  - A `User-Agent` matching SPEC section 4. Its sdk token MUST equal `language`, and its runtime token MUST equal the sdk token.
  - `Accept: application/json`.
  - `Content-Type: application/json` when there is a body.
  - An `Idempotency-Key` on POST/PATCH, and none on GET/DELETE.
- **Requests:**
  - The exact number of requests, in order.
  - Per request: `method`, `path` (raw, still percent-encoded), the exact `query` map, header matchers, `absent_headers`, `json` (**exact** deep equality: no extra keys, so unset fields must be omitted), `json_subset`, `no_body`, `idempotency_key_same_as: i`, and `idempotency_key_differs_from: i`.
- **Steps:**
  - Each step's `result` (subset match) or `error` (each listed field must match).
  - `message_excludes` strings must not appear in the error message.
- **Case-level expectations** (when present):
  - `sleeps_ms`: exact.
  - `warnings`: the same multiset of codes.
  - `on_error`: count, plus a subset match per call.
  - `logs_exclude`: strings that must not appear in logs or `on_error`. This is how private-mode redaction is checked.
- **Unused responses:** every scripted response must be consumed.

### Matchers

Inside expectations:

- `{"$any": true}`: any value, but present.
- `{"$absent": true}`: the key must be missing.
- `{"$regex": "…"}`
- `{"$uuid4": true}`
- `{"$one_of": [...]}`
- `{"$len": n}`

Objects are subset-matched, except request `json`, which is exact. Arrays need the same length.

### Mock responses (in case files)

`responses` is a queue consumed in request order. Each entry is one of:

- `{"status", "headers"?, "json"?}`
- `{"status", "body_text"}`
- `{"status", "body_base64"}`
- Any of the above plus `"delay_ms"`. The mock waits before answering; cases set `timeout_ms` below this to produce timeouts.
- `{"action": "reset"}`: the socket is destroyed, which gives a network error.

A request with no scripted response gets `500 mock_unexpected_request`, and is counted against the case.

### Adding a case

1. Edit `tools/build-cases.mjs`, then run it.
2. Run every SDK's runner. A new case must pass in all of them, or it needs a `languages` list with a reason in its description.
3. If the case changes behaviour, update `SPEC.md` in the same change.

### Control API reference

| Route | Purpose |
|---|---|
| `GET /__control/cases?language=` | the cases for a language |
| `POST /__control/start` `{case_id}` | reset and load a case |
| `POST /__control/finish` `{case_id, …Outcome}` | judge it |
| `GET /__control/requests` | the requests recorded so far, for debugging |
| `GET /__control/report` | totals for this server's run |
| `POST /__control/shutdown` | stop the server |
