# Progress: Change 23 S (strict goal names: `unknown_goal`, `goal_archived`), 2026-11-08

Spec: `docs/spec/clikgate-change-23-unknown-goals-goal-groups.md` S, R.1, R.9. Decisions: [DECISIONS.md](DECISIONS.md)
"Change 23 S". No version bumped. `server/codegen/generate.mjs` not run (owner regenerates later).

| Item | Status |
|---|---|
| Refusal body (`422 {status: refused, reason}`, no envelope) → code = reason | Node, Python, PHP, Java, .NET |
| Final: no retry, no re-queue, `on_error` dropped; Laravel job ends without failing | all five + Laravel |
| Debug line ``Goal `{name}` isn't set up in Clikgate`` (debug level, name only) | Node, Python (sync + async), PHP, Java (`ClikgateLogger.debug` default method), .NET |
| SPEC | sections 5, 12.3, 15, 23.2 |
| Conformance | 8 new `goals` cases (511 total); `--check` passes |
| Tests | Node `strict-goals.test.ts` (5), Python `test_strict_goals.py` (6), PHP `StrictGoalsTest` (5), Laravel (1), Java `StrictGoalsTest` (5), .NET `StrictGoalsTests` (4) |

# Progress: Change 19 C19-S1 S.3 (hashed email and phone for ad network matching)

Spec: `clikgate_api/docs/spec/clikgate-change-19-ad-networks.md` R.20 S.3, R.4, R.5; backend C19-B4. Contract:
`server/SPEC.md` section 25 (and the 9.1 / 12.2 rows). **No version bumped** (entries under "Unreleased").

| Item | Status |
|---|---|
| Goal options `hashed_email`, `hashed_phone_e164`, `hashed_phone_digits` (goal, goals.send, batch; conversions.create params) with the local `invalid_hashed_identifier` check | Node, Python (sync + async), PHP, Java, .NET |
| `hash_for_ads` helper (R.5 normalisation; website vectors) | Node `hashForAds`, Python `hash_for_ads`, PHP `HashForAds::hash`, Java `HashForAds.hash` → `HashedIdentifiers`, .NET `HashForAds.Hash` → `HashedIdentifiers` |
| Private-mode guard allows the three fields on goals and conversions | all five |
| Conformance | new suite `ads_matching` (7 cases, new step `hash_for_ads`; 501 total); `private_mode.on.order` now uses `hashed_phone` (still refused) |
| Docs | READMEs ("Match by hashed email or phone"; "in private mode, hash on your own server"), CHANGELOGs |
| Generated layer | not regenerated: after the lead regenerates `docs/openapi.json`, run `node server/codegen/generate.mjs --from ../clikgate_api` so `api.goals.*` / `api.conversions.*` request types gain the fields |

Test runs (2026-11-04): Node `node scripts/run-tests.mjs`: 51 unit tests pass, conformance 499/499; eslint clean.
Python: pytest unit 110 passed, conformance 494/494 (sync and async), mypy strict and ruff clean. PHP: phpunit 49
tests, conformance 492/492, PHPStan max, php-cs-fixer clean; php-laravel phpunit 7 (one unreproduced flaky failure
on the first run). **Java and .NET: not compiled or run** (no Maven / dotnet builds on this machine).

---

# Progress: Changes 13 and 14 (server SDKs, AI guides)

| Item | Status |
|---|---|
| Generated layer | regenerated from `server/openapi/openapi.json` (523 operations, 843 schemas): Change 13 and 14 APIs, the removed `POST /v1/apps/{app_id}/identify`, the App banners rename (`AppBannersApi`, `filter.mjs` `ID_PREFIX` `app_banner: 'jrn'`), `filter-report.txt`. regenerated again after the `/v1/me` membership and sign-in schema update (the earlier null-only workaround in `codegen/filter.mjs` is removed: the OpenAPI no longer has `{"type": "null"}` schemas) |
| `identifyUser` (C14-S1) | Node `identifyUser`, Python `identify_user` (sync + async), PHP `identifyUser`, Java `identifyUser(IdentifyUserParams)` → `PersonIdentified`, .NET `IdentifyUserAsync` → `PersonIdentified`; local reference checks; guard kind `identify` (customer ID refused in private mode); SPEC §24 |
| Goal `label` | all five SDKs; allowed by the private-mode guard (the API checks the private-mode labels switch) |
| Conformance | new suite `people` (6 cases; 461 total): node 459, python 454 + 454 async, php 452, java 453, dotnet 452 passing |
| AI guides | `goals.md` (identifyUser, labels, `isFirst` from the server), `web.md` (identifyUser, share buttons), `SKILL.md` (Engage share helpers), `api-surface.md` regenerated (namespaced web methods such as `Clikgate.share.mount` now listed); `check.mjs`, `check-code-blocks.mjs`, `build.mjs` pass |

---

# Progress: Change 12 (server SDKs and AI guides)

Spec: [spec/clikgate-change-12-goal-kinds-onboarding.md](spec/clikgate-change-12-goal-kinds-onboarding.md) S.3, S.4,
S.5 (workspace header first); backend contract C12 (all milestones final, plus the coordinator follow-up of
2026-10-28: server Payment goals need `provider` and `reference`, `POST /v1/conversions` answers the goal event for a
Payment goal). **No version bumped**: the breaking changes are under "Unreleased" in every CHANGELOG.

| Item | Status | Where |
|---|---|---|
| `openapi.json` sync + regeneration | done: 473 API-key operations, 741 schemas, 311 skipped. `--check` passes for all five languages. The codegen now also strips internal plan references from descriptions, and deletes / reports files it no longer generates (the stale `WordPressPluginApi` in PHP, Java and .NET is gone; Java `package-info.java` is exempt) | `server/codegen/generate.mjs`, `filter.mjs` |
| Enums `GoalKind`, `GoalStatus`, `Provider` (D5) | done: generated from `openapi.json` by `server/codegen/enums.mjs` (covered by `--check`, so a new gateway is drift). Node `GoalKind.Payment`, Python `GoalKind.PAYMENT` (str enum), PHP `GoalKind::Payment`, Java and .NET `GoalKind.PAYMENT`; `Provider` takes newer gateways (string / `fromString`) | SPEC §23 |
| S.3 goal models | done: generated goal object has `kind` + `suggest_payment`, no `confirmation`; `GoalEvent.status` is the `GoalStatus` (old value in `event_status`), plus `goal_kind`, `value_ignored`, `payment`; `provider` goal option (local `invalid_provider`), on the private-mode allow-list; payment helpers use `Provider`; `conversions.create` handles the `Conversion | GoalEvent` union | all five SDKs |
| Conformance | done: 453 cases (was 402). New: every goal `status` value, the B2 error codes (`unknown_provider`, `value_required`, `invalid_value`, `code_not_supported`, `payment_goal_needs_confirmation`, `validation_error` for `kind`, `plan_feature_unavailable`), provider cases, Payment goals from the server, the conversions union, the `compat` suite (older versions ignore unknown fields and enum values), non-retryable 5xx (505/507/508/511/599 and a background 501) | `server/conformance` |
| SPEC fixes (docs audit) | done: §22.2 `plan_upgrade_required` → `403 plan_feature_unavailable` (`required_plan: starter`, `feature: payment_goals`; checked in `clikgate_api/src/payments/services/plan_gate.py`); §7 idempotency matches the code (random key per call since 1.1.0, `200` stored event, 4xx stored, `idempotency_key_reused`); retry wording in every SDK says 429/500/502/503/504 (PHP code was already right) | `server/SPEC.md` |
| S.4 release scan | done: `server/scripts/scan-package.mjs` (zero-dependency; self-test) scans npm tgz, wheel + sdist, Composer zips, jars (incl. sources/javadoc), nupkg + snupkg for notes, debug code, internal/staff URLs, staff-only and internal references. Every package scans clean; the scan step is in each language's CI and release workflow. Removed: internal plan references in comments and changelogs, the unused deprecated `idempotencyKey` helpers (PHP, Java, .NET); PHP `.gitattributes` export-ignore | `.github/workflows/server-*.yml` |
| S.5 docs | done: SDK readmes and CHANGELOGs; AI guides (one `goal()`, enums, "Payment goal", no `payment()`, required provider/reference, new error codes); `api-surface.md` regenerated from the new mobile SDKs and the readable web script source (`clikgate_api/webscript/src/clikgate.js`), with the Node and web enums | `ai-guides/` |

| Follow-up: `consent` in private mode | done: the guards in all five SDKs allow `consent` on goals and conversions, matching `clikgate_api/src/private_mode/utils/private_mode.py` (`GOAL_EVENT_FIELDS`, `CONVERSION_FIELDS`); payment confirmations also allow `refund_id` and `source_plugin` (`src/payments/services/confirmations.py`). The reversal list stays stricter than the backend on purpose. SPEC §9.1 / §12.2, readmes, AI guides and unit tests updated; conformance `private_mode.on.consent*` | `server/*/…Guard*` |
| Follow-up: .NET deterministic paths | done: `PathMap` in `server/dotnet/Directory.Build.props`; a plain local `dotnet pack` (no flags) scans clean | |

| Follow-up: backend description rewording | done: `openapi.json` re-synced (114 descriptions reworded, schemas and operations identical), all five layers regenerated (473 / 741 / 311 skipped), `--check` passes; generated layers and the npm tarball scan clean |  |

| Follow-up: public spec without staff routes | done: `openapi.json` re-synced (619 operations, no `/v1/staff` path; was 784 with 165 staff operations, all skipped by the filter, so no staff API was ever generated). 473 kept / 741 schemas / 146 skipped; `--check` passes. `generate.mjs` now fails on any staff path or `x-clikgate-auth: staff` operation in the copy | `server/codegen/generate.mjs` |

## Test runs (2026-10-28)

- Unit: Node 34 (typecheck, lint, examples clean), Python 49 (mypy, ruff clean), PHP 27 tests / 123 assertions (PHPStan, cs clean), Laravel 5 / 16, Java core 20 (Client 10, Enums 4, Payments 6) + javax 2 + jakarta 2 + starter 3, .NET 50 (0 warnings, `dotnet format` clean).
- Conformance: Node 453/453, Python 448/448 sync and async, PHP 446/446, Java 447/447, .NET 446/446 (455 cases; totals differ by `languages`). `build-cases.mjs --check` passes.
- AI guides: `check.mjs` passed (15 files); `generate-api-surface.mjs --check` up to date; `check-code-blocks.mjs --swift-typecheck` passed (dart and kotlin skipped: no flutter / kotlinc); `build.mjs` built.
- The website's `check:ai-guides` reports drift: it needs `pnpm sync:ai-guides` (not run here: it also writes `apps/www/src/data`).

## Versions needed

All packages are 1.1.0, unreleased. The changes break the public API (`GoalEvent.status` meaning and type, removed helpers, typed provider), so: if nothing is published before this lands, release as is (fold into the first release); if any 1.x is published first, the next release of every server SDK must be **2.0.0** (Node, Python, PHP + Laravel, Java + servlet filters + Spring Boot starter, .NET + AspNetCore).

---

# Progress: Change 10 (server SDKs and AI guides)

Spec: [spec/clikgate-change-10-platforms-marketplaces.md](spec/clikgate-change-10-platforms-marketplaces.md) D.5;
backend contract C10 (B2.8 `subscription.updated`, B3a deep links; all milestones final). **Versions stay at 1.1.0
(unreleased)**: the Change 10 work is folded into it, as no repository rule asks for a new number for unreleased work.

| Item | Status | Where |
|---|---|---|
| Webhook `subscription.updated` | done: `type` is a plain string in every SDK, so nothing needed a type change. Named on the event type's docs (Node, Python, Java, .NET), SPEC section 20, and a signed-event conformance case | `webhooks.valid.subscription_updated` |
| Codegen against the final `openapi.json` | done: 756 operations, **460** API-key operations kept and 710 schemas (was 445 / 678); 296 skipped (`server/openapi/filter-report.txt`). `--check` passes for all five languages | `server/codegen`, `server/openapi` |
| Fraud rules hidden from the public (backend 2026-10-28) | done: `openapi.json` synced (757 operations, **461** kept, 718 schemas). New `fetchFraudRules` / `fetch_fraud_rules` (`GET /v1/fraud/rules`); `FraudSampleResponse` loses `score` / `threshold`, `reasons` is `{rule, name}[]`, plan outcomes lose `threshold`. `GET /v1/public/fraud-rules` is `public`, so not generated. No conformance case covers these endpoints. No version bump made (removals in a response type; see the report) | `server/openapi`, generated layers |
| Metadata filters (coordinator request) | done: the backend reads `metadata[<key>]` from the raw query string, so `openapi.json` doesn't declare it. `filter.mjs` adds a `metadata` map parameter to `GET /v1/links` and `/v1/analytics/summary`, `/timeseries`, `/top-links`, `/open-in-app`; every transport sends a map value as `key[sub]=value` | SPEC section 21; conformance `links.list.metadata_filter`; unit tests in all five SDKs |
| Java / .NET `Link` metadata (coordinator request) | done: `Link.getMetadata()` / `getExternalReference()` (Java), `Link.Metadata` / `ExternalReference` (.NET) | `Link.java`, `Models.cs` |
| `end_goal_value` type (coordinator request) | **already right in the SDKs**: the final `openapi.json` types it as a map of decimal strings next to `end_goal_value_minor`, and Node / Python generate exactly that. PHP, Java and .NET have no typed analytics models (they return parsed JSON, strings stay strings). The integer type the website saw is in its own older `apps/www/public/openapi.json` copy. Unit tests now assert the string values in every SDK | |
| AI guides | deep links on Free and Starter, `yourapp.clk.ng` (an app subdomain, not the shared `clk.ng`), debug `yourapp.dev.ciz.to`, attribution / events / goals need Growth, the one-time "needs Growth" warning, the deferred allowance; `subscription.updated`; the metadata filter | `SKILL.md`, `plain/AGENTS.md`, `references/goals.md`, `troubleshooting.md`, `server-sdks.md` |

## Test runs (2026-10-27)

- Unit tests: Node 21 (typecheck and lint clean), Python 20 (ruff and mypy clean), PHP 11 (50 assertions, phpstan clean), Laravel 4, Java core ClientTest 10 + javax 2 + jakarta 2 + starter 3, .NET 12 (built with `-warnaserror`, `dotnet format` clean).
- Conformance: Node 284/284, Python 279/279 sync and 279/279 async, PHP 277/277, Java 278 cases (ConformanceTest passed; the count isn't printed in quiet Maven mode), .NET 277/277. `build-cases.mjs --check` passes (286 cases).
- AI guides: `check.mjs` passed (14 files); `generate-api-surface.mjs --check` up to date; `check-code-blocks.mjs --swift-typecheck` passed (Kotlin skipped: no `kotlinc`); `build.mjs` built; website `pnpm sync:ai-guides` (27 files) and `check:ai-guides` pass.

## For the website team

The platform samples in `clikgate_website/apps/www/samples/platforms/` can now use the metadata filter directly:
Node `analyticsSummary({ …, metadata: { seller_id: 'sel_ada' } })`, Python `analytics_summary(…, metadata={…})`,
PHP `analyticsSummary(…, metadata: […])`, Java and .NET a `"metadata"` map entry in the query map; and Java
`link.getMetadata().get("seller_id")`, .NET `link.Metadata["seller_id"]` instead of the raw map / `Raw["metadata"]`.
The website's `public/openapi.json` should be refreshed from the backend (its `end_goal_value` is still integer).

---

# Progress: Change 09 (server SDKs and AI guides)

Spec: [spec/clikgate-change-09-consistency-security.md](spec/clikgate-change-09-consistency-security.md). Backend
shapes: the C9 backend contract (B1 final, B2 final, B3 shapes). All server SDKs are at **1.1.0** (Node, Python,
PHP + Laravel, Java + servlet filters + Spring Boot starter, .NET + AspNetCore).

| Item | Status | Where |
|---|---|---|
| X.E15 goal `Idempotency-Key` | done: `goals.send` and sync-mode `goal()` send one random UUIDv4 per call, reused across its retries; `sha256(goal:reference)` removed (the PHP, Java and .NET helpers stay, deprecated and unused). The `idempotency_key` option still overrides | `server/SPEC.md` §7; conformance `idempotency.goal.*` (incl. `retry_reuses_key`, `override`) |
| X.E10 `value` + `value_minor` | done: goal event models expose `value` (decimal string) plus `value_minor` and `reversed_value_minor` (Node, Python, Java, .NET; PHP arrays pass them through) | conformance `goals.send.value_minor` |
| X.E7 cookie and payment metadata | **already done**: cookie `_cg_<param>`; `cg_click_id` read first in `from_payment_metadata` | `server/SPEC.md` §13 |
| D8 | **already done**: no hand-written trophy, challenge or progress helpers; reachable through the generated `api.*` only | |
| N.4 goals APIs | codegen refreshed from `clikgate_api/docs/openapi.json` after B1 final (424 operations): `api.goals.*`, `api.funnels.*` | `server/codegen`, `server/openapi/openapi.json` |
| N.1 AI guides | app link subdomains everywhere (rules, offline `--domain`, doctor `*.shared_domains`, `clikgate.<platform>.link_subdomain`, `link_subdomain_not_confirmed`), shared-domain opt-in removed, test subdomains | `ai-guides/clikgate-setup/**`, `plain/AGENTS.md`, `public/README.md` |
| New goal APIs in the guides | goal management (`/v1/goals`, `/v1/funnels`), random `Idempotency-Key`, `value_minor`; web goals with the publishable web key (`data-web-key`, "Allow from browser") | `references/goals.md`, `server-sdks.md`, `web.md` |
| `api-surface.md` | regenerated (SDK versions, `ClikgateMoney.ofMinor` on every platform, `data-web-key`, Expo props) | `scripts/generate-api-surface.mjs` |

## Test runs (2026-10-27)

- Unit tests: Node 20, Python 19, PHP 10 (44 assertions), Laravel 4, Java core 10 + javax 2 + jakarta 2 + starter 3, .NET 11; lint and static analysis clean.
- Conformance: Node 282/282, Python 277/277, PHP 275/275, Java 276/276, .NET 275/275 (totals differ by language-specific money cases); `build-cases.mjs --check` and `codegen --check` pass.
- AI guides: `check.mjs` passed (14 files); `generate-api-surface.mjs --check` up to date; `check-code-blocks.mjs --swift-typecheck` passed (Kotlin skipped: no `kotlinc`); `build.mjs` built; website `pnpm sync:ai-guides` and `check:ai-guides` (27 files) pass.

## Open

- Every server CHANGELOG still lists 1.0.0 as unreleased: the owner may fold 1.1.0 into 1.0.0.

## Follow-up against the final backend contract (B1–B8 final, 2026-10-27)

- **Codegen re-run:** `generate.mjs --from ../clikgate_api` was run on the final `openapi.json`, which has 720
  operations. It kept **445** API-key operations and 678 schemas, and skipped 275 (dashboard, staff, public,
  `sdk_key` and `cli` operations; see `server/openapi/filter-report.txt`). That is up from 424/641. The new
  ones include the challenges (`api.challenges.*`: create, list, fetch, update, delete, schedule, cancel,
  duplicate, save as template, participants, results, compare, templates) and `leaderboardTrophy`.
  `--check` passes for all five languages.
- **Challenge and trophy helpers: none hand-written.** SPEC §16 keeps the hand-written layer to goals,
  conversions, links, clicks, click IDs, webhooks and the guard, and D8 says trophy and challenge data are read
  through the server API only. The generated `api.*` operations cover B6/B7. Webhook `type` is a plain string in
  every SDK, so the new `challenge.*` and `leaderboard.target_*` events need no change.
- **Verified, no change:**
  - `from_payment_metadata` reads `cg_click_id` first in every SDK (then `cgid`, `clikgate_click_id`), the same
    keys as the backend's `src/sales/providers/normalize.py`. That covers WooCommerce `meta_data` lists
    (conformance `click_ids.payment_metadata.woocommerce_meta_data`).
  - `cg_link_id` is read by the backend and sent by the WooCommerce plugin (clikgate_api `integrations/`). The
    SDK helper returns only the click ID.
  - The random `Idempotency-Key` for each goal call is reused across that call's retries (SPEC §7; conformance
    `idempotency.goal.*`).
- **Test runs:**
  - Unit tests: Node 20 (plus typecheck and lint), Python 19 (plus ruff and mypy), PHP 10 (44 assertions,
    phpstan clean), Laravel 4, Java core 10, javax 2, jakarta 2, starter 3, .NET 11 (built with
    `-warnaserror`).
  - Conformance: Node 282/282, Python 277/277 sync and 277/277 async, PHP 275/275, Java 276/276, .NET 275/275.
  - `build-cases.mjs --check` (284 cases) passes.
  - AI guides: `check.mjs` (14 files) and `generate-api-surface --check` pass. The guides were unchanged, and
    the website's `check:ai-guides` (27 files) matches.
  - Versions stay at 1.1.0 (unreleased).


# Progress: Change 22 C22-B3, server SDKs and AI guides (2026-11-08)

- **Sweep:** the generated app events resource (Node `api.appEvents`, Python `api.app_events`, PHP/Java/.NET
  `AppEventsApi`) is gone from every SDK (via `server/codegen/removed.mjs`, see DECISIONS). The hand-written SDKs never
  had a track method; Node's internal queue helper was renamed. `server/SPEC.md`, READMEs, changelogs and AI guides
  updated; no "events and goals need Growth" wording left.
- **Identity:** `createIdentityToken` in Node, Python, PHP, Laravel, Java, Spring Boot starter and .NET (names in
  `server/SPEC.md` section 26), shared vectors in `server/conformance/vectors/identity-token-vectors.json`.
  `identifyUser` docs show path B in every SDK (doc comments, READMEs, SPEC section 24).
- **GoalStatus `received`** in every SDK's enums, docs and conformance (2 new cases, 503 in total).
- **CI guard:** `node scripts/check_no_track.mjs` (and `--self-test`) passes; workflow `no-track-guard.yml`.
- **Test runs (2026-11-08):**
  - Node: unit 57 (6 new identity tests), conformance 501/501, lint, typecheck, typecheck:examples.
  - Python: unit 135 (25 new identity tests), conformance 496/496 sync and 496/496 async, ruff, ruff format, mypy.
  - PHP: unit 67 tests / 753 assertions, conformance 494/494, phpstan (max), php-cs-fixer. Laravel: 9 tests.
  - Java (`mvn verify -Dconformance=true`, all modules): core 37 incl. 7 identity, conformance 495/495, servlets 10,
    starter 5.
  - .NET: `dotnet build Clikgate.sln -c Release` (warnings as errors, all TFMs), `dotnet format --verify-no-changes`,
    tests 78 (net10.0), conformance 494/494.
  - `generate.mjs --check`, `filter.test.mjs` (8), `build-cases.mjs --check` (503),
    `build_identity_token_vectors.py --check`, `ai-guides/scripts/check.mjs` (15 files), `build.mjs`,
    `check-code-blocks.mjs` (ts and swift; dart/kotlin skipped locally: no flutter/kotlinc).
- **Open:** re-sync the OpenAPI document after backend C22-B1, and regenerate `api-surface.md` after the mobile C22
  work (both in DECISIONS). Pre-existing: the release scan (`server/scripts/scan-package.mjs`) flags older CHANGELOG
  headings that say "change 16" / "change 19"; the new entries avoid change numbers.

## Change 23 C23-W1: AI guides (2026-11-08)

- [x] `unknown_goal` / `goal_archived` and goal groups in `SKILL.md` and the goals, troubleshooting, server-sdks and
      payments references (DECISIONS "Change 23 C23-W1").
- [x] `node ai-guides/scripts/check.mjs` (15 files), `build.mjs`, `node scripts/check_no_track.mjs` (+ `--self-test`)
      pass; website re-synced (`check:ai-guides`: 29 files match).
