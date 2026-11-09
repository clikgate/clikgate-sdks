# Decisions: clikgate_sdks

Dated decisions and documentation findings for this repository (server SDKs in `server/`, AI guides in `ai-guides/`). Each part appends its own section. The setup command (`cli/`) moved to `clikgate_mobile_sdk` on 2026-10-26; its decisions are in `clikgate_mobile_sdk/cli/DECISIONS.md`.

## Server SDKs (`server/`), C6-S3: foundation and Node.js SDK

### Workspace decisions applied (2026-10-26)
- Licence: MIT. Layout: `server/` at the root of `clikgate_sdks` (the spec's `sdks/server/`). Link domains: `ciz.to` (paid), `dev.ciz.to` (test).
- The contract is `server/SPEC.md`. It is checked by `server/conformance/`: 279 cases, judged by the mock server, so every language runner shares one set of matching rules.

### Contract decisions (with reasons)
- **The config fetch fails closed.** If `GET /v1/server-sdk/config` can't be loaded (network, 5xx, 404 from an older backend), the private-mode guard is **on**, the SDK tries again after 60 s, and allowed goals are still sent. It is a single attempt without retries, so the first goal isn't delayed by backoff. *Reason:* a bank's personal data must never leave because a config call failed. The guard only refuses fields outside the allow-list, which normal goal calls don't use.
- **Goal-rule warnings are warn-only** (`unknown_goal`, `value_not_allowed`, `value_required`). *Reason:* config can be 10 minutes stale, and the server decides.
- **`Retry-After` above 60 s is not waited for:** the error is thrown with `retry_after`. A `Retry-After` up to 60 s is honoured exactly, without jitter, on 429 and 503.
- **`409 idempotency_request_in_progress` is not retried,** following S.12 ("never other 4xx"). It is safe to resend later.
- **Same goal and reference with a different body gives `409 idempotency_key_reused`** (backend `src/core/idempotency/idempotent_route.py`). That is by design: correct a goal with `goals.reverse`. **Reversals use random keys**, because two identical partial refunds are legitimate.
- **Background whole-batch failures:**
  - Retryable failures are re-queued at the front, up to 3 failed rounds, then dropped with `on_error`.
  - Non-retryable failures are dropped at once.
  - At most one batch is in flight, so requests leave in order.
- **`goal()` never throws in any mode, including sync,** so PHP's default sync mode can't break business code. `goals.send()` throws.
- **Click-ID cookie:** `_cg_<param>`, `Path=/`, `SameSite=Lax`, `Secure` on HTTPS, not `HttpOnly`. This is the same cookie the web script writes (`clikgate_api/src/static/clikgate.js`). The server default is 30 days (S.14); the web script's is 7.
- **`from_payment_metadata` keys** follow the backend (`src/sales/providers/normalize.py`): `cg_click_id`, `cgid`, `clikgate_click_id` in the payload, `data`, `metadata`, `meta`, `meta_data`, `note_attributes`, `customAttributes` and `custom_fields`.
- **User-Agent:** `clikgate-<sdk>/<v> (<sdk> <runtime v>; <os> <arch>)`, with versions sanitised to `[0-9A-Za-z.+-]`. *Reason:* the backend parser (`src/server_sdk/utils/user_agent.py`) rejects anything else, and Java's `1.8.0_402` would otherwise be lost. The runtime token is the lowercase SDK token (`dotnet`, not `.NET`).
- **Backend shapes coded to (checked 2026-10-26):**
  - `ServerSdkConfigResponse` (`mode`, `organization_id`, `private_mode`, `click_id_param`, `goals[{key, value_mode, default_currency}]`, `minimum_sdk_versions`).
  - `domain_badge` on links.
  - The error extras: `test_destination_not_allowed` (`allowed`, `doc_url`), `test_link_limit_reached` (`limit`), `plan_limit_reached` (`required_plan`), plus `domain_mode_mismatch` and `cli_scope`.
  - Still being built in the backend, coded to the spec shapes: `202` + `link_change_request` and `409 link_locked` (B.10), and `no_preview` (B.11).

### Generator choice (S.16), 2026-10-26
**OpenAPI Generator 7.26.0** (released 2026-10-06; Apache 2.0) with custom templates. The comparison is in `server/codegen/README.md`.
- **Kiota 1.36.1** was rejected: it needs runtime packages in every language (for TypeScript, `@microsoft/kiota-*` 1.0.0-preview), which breaks S.13's dependency budget; and its TypeScript output is still "preview".
- **Speakeasy** was rejected: it is commercial SaaS (hooks only on Business or Enterprise), its TypeScript output depends on Zod, and it needs an account in CI.
- **OpenAPI 3.1** is beta in OpenAPI Generator, so `filter.mjs` down-converts the backend's 3.1 constructs to 3.0.
- **The JAR** is pinned with its SHA-256 (it matches Maven Central's SHA-1).
- **Scope:** `--from ../clikgate_api` also reads `docs/API.md`'s Auth column, because openapi.json doesn't mark dashboard-only or staff routes. That gives 400 API-key operations and 600 schemas, with 213 operations skipped (listed in `server/openapi/filter-report.txt`).
- **Suggestion to the backend:** add an `x-clikgate-auth` extension per operation, so the SDKs don't depend on `API.md`.

### Toolchain decisions
- **TypeScript 6.0.3, not 7.0.2:** typescript-eslint 8.72 supports `typescript >=4.8.4 <6.1.0` (checked on npm 2026-10-26).
- **ESM and CJS are built by `tsc` twice:** `module: CommonJS` with `moduleResolution: Bundler` is accepted by TS 6. Each output folder has its own `.d.ts` and a `package.json` with its `type`.
- **Tests:** `node:test` on compiled output, so the same tests run on Node 18. Verified locally on Node 18.20.8 (the official darwin-arm64 binary, checksum verified): 18 unit tests pass, the 2 Fastify/Next tests skip, and 277/277 conformance cases pass.
- **The Next.js add-on imports `next/server.js`,** because Next has no `exports` map, so plain Node ESM needs the extension (bundlers resolve it too).
- **The Fastify plugin doesn't depend on `fastify-plugin`.** It sets the same `Symbol.for('skip-override')` metadata, to keep the zero-dependency rule.

### Documentation findings (checked 2026-10-26)
- **Node.js release schedule** (github.com/nodejs/release, nodejs.org/en/about/previous-releases):

  | Line | Status | End of life |
  |---|---|---|
  | 18 | EOL | 2025-04-30 |
  | 20 | EOL | 2026-04-30 |
  | 22 | Maintenance LTS | 2027-04-30 |
  | 24 | Maintenance LTS since 2026-10-20 | 2028-04-30 |
  | 26 | Current, becomes Active LTS on **2026-10-28** | 2029-04-30 |

  From Node 27, releases are annual. **CI matrix: 18 (the S.9 minimum), 22, 24 and 26** on Ubuntu and Windows.
  - Note for the owner: S.13 says runtime support is dropped only after end of life. Node 18 has been EOL since 2025-04, so dropping it in a future major version is allowed.
- **Express 5.3.0** (expressjs.com 5.x API; `engines: node >= 18`):
  - The middleware signature `(req, res, next)` is unchanged.
  - Rejected promises go to the error handler.
  - `req.query` is a read-only getter, parsed "simple" by default. The add-on parses `req.originalUrl`/`req.url` itself, so it also works on bare Connect.
  - `express.raw({ type: 'application/json' })` returns a `Buffer` for webhooks. Mount it before any global `express.json()`.
- **Fastify 5.12.7** (fastify.dev; v5 needs Node 20+; 6.0 is alpha):
  - In v5, reference-type decorators must start as `null`, so the plugin calls `decorateRequest('clikgate', null)` and sets the value in `onRequest`.
  - Repeated `reply.header('set-cookie', …)` calls append.
  - For a raw webhook body, use `addContentTypeParser('application/json', { parseAs: 'buffer' }, …)` in an encapsulated scope.
- **Next.js 16.4.3** (nextjs.org/docs/app/api-reference/file-conventions/proxy, updated 2026-09-04; needs Node 20.9+):
  - `middleware.ts` was renamed **`proxy.ts`** (export `proxy`) in 16.0. Proxy defaults to the Node.js runtime; `middleware.ts` is deprecated but still works.
  - Response cookies: `NextResponse.next()` + `response.cookies.set` / `headers.append('set-cookie')`.
  - `cookies()` from `next/headers` is async (synchronous access was removed in 16).
  - Route handlers read the raw body with `await request.text()`.
  - So the add-on exports **`clikgateProxy`** (and `clikgateMiddleware` as an alias), and the docs show `export { clikgateProxy as proxy }`. **This differs from S.14**, which says `export { clikgateMiddleware as middleware }`; the docs win.
- **npm trusted publishing** (docs.npmjs.com/trusted-publishers):
  - It needs npm CLI ≥ 11.5.1 and Node ≥ 22.14.0, `permissions: id-token: write`, and a GitHub-hosted runner.
  - It is configured per package on npmjs.com: owner, repository, workflow **file name** (`server-node-release.yml`) and an optional environment (`npm`). A new configuration must publish within 2 days.
  - **Provenance is automatic** with trusted publishing (public repository and package); `--provenance` is kept explicit.
  - Classic tokens were revoked in late 2025, and write-enabled granular tokens are limited to 90 days, so trusted publishing is the only reasonable path.
  - **Unconfirmed in the docs:** whether the package must exist before trusted publishing can be configured. The settings page implies it does, so plan for one first manual publish with 2FA, or check `npm trust` at C6-S6.
  - Recommended after setup: "Require two-factor authentication and disallow tokens".
- **CycloneDX** (cyclonedx.org; github.com/CycloneDX/cyclonedx-node-npm):
  - The current specification is 1.7 (2025-10-21).
  - `npm sbom --sbom-format cyclonedx` (npm ≥ 10.2) still emits **1.5**.
  - `@cyclonedx/cyclonedx-npm` **6.0.1** (2026-08-11; Node ≥ 20.18) emits up to **1.6** and has reproducible output.
  - **Choice:** `@cyclonedx/cyclonedx-npm@6.0.1 --omit dev --omit peer --omit optional --package-lock-only --spec-version 1.6 --output-reproducible`, attached to the GitHub release. With zero runtime dependencies the SBOM lists only the package itself, which is the point.
- **GitHub Actions** (pinned to commit SHAs, matching the setup command's workflows, now in `clikgate_mobile_sdk`):
  - `checkout` v7.0.1, `setup-node` v7.1.0, `setup-java` v6.1.0, `cache` v6.1.0, `upload-artifact` v7.0.2, `download-artifact` v8.0.2.
  - setup-node v7 no longer sets a dummy `NODE_AUTH_TOKEN`. That doesn't affect OIDC publishing; `registry-url` is kept, as in npm's own example.
- **Workflow validation:** actionlint couldn't be downloaded in this environment. The workflows were parsed with `yaml` (strict, unique keys) and checked for `runs-on`, valid `needs`, matrix keys, and SHA-pinned `uses`.

## Setup command: moved to `clikgate_mobile_sdk` (2026-10-26)

- **Setup command moved from clikgate_sdks to clikgate_mobile_sdk (owner decision); keeps MIT.** It is tightly coupled to the mobile SDKs' versions, configure APIs and snippets, so changes now land with them in one PR.
- The command is `clikgate_mobile_sdk/cli/` (`@clikgate/setup`, still MIT with its own `LICENSE`), with its workflows `cli.yml` and `cli-release.yml` (tags `cli-v*`; the npm trusted publisher names repository `clikgate-mobile-sdk`).
- Its decisions and documentation findings (C6-S1 and C6-S2, previously this section) are in `clikgate_mobile_sdk/cli/DECISIONS.md`; usage and publishing in `clikgate_mobile_sdk/docs/SETUP_COMMAND.md`.
- The AI guides stay here. `ai-guides/scripts/check.mjs` and `ai-guides/qa/run.sh` read the command from `CLIKGATE_CLI_DIR` (default: the sibling checkout `../clikgate_mobile_sdk/cli`); `ai-guides.yml` checks out `clikgate/clikgate-mobile-sdk` for it, and also runs weekly because changes in that repository don't trigger it.

## AI guides (`ai-guides/`), C6-S7

### Workspace decisions applied (2026-10-26)

- **Location:** `ai-guides/` at the root of `clikgate_sdks` (the spec's `sdks/ai-guides/`). The skill is `ai-guides/clikgate-setup/`. **Licence:** MIT.
- **Link domains:** `ciz.to`, `clk.ng`, `clkg.to` (shared) and `dev.ciz.to` (test, debug builds only).
- **Server SDKs:** only `@clikgate/node` is available. The guides mark Python, PHP, Java and .NET as **not available yet** (coordinator, 2026-10-26), and give the HTTP API instead of inventing install lines.

### Documentation findings (checked 2026-10-26)

**Agent Skills format.** Sources: the open specification (agentskills.io/specification refused connections, so it was read from `github.com/agentskills/agentskills` `docs/specification.mdx`) and Anthropic's overview (platform.claude.com/docs/en/agents-and-tools/agent-skills/overview).
- A skill is a folder with `SKILL.md`, which starts with YAML frontmatter on line 1.
- `name` is required:
  - 1–64 characters, lowercase letters, digits and single hyphens;
  - it must match the folder name;
  - no XML tags;
  - no reserved words "anthropic" or "claude".
- `description` is required: 1–1024 characters, no XML tags. It says what the skill does and when to use it.
- Optional keys: `license`, `compatibility` (≤ 500), `metadata` (a string map) and `allowed-tools` (experimental).
- Optional folders: `scripts/`, `references/` and `assets/`.
- Progressive disclosure:
  - metadata (about 100 tokens) is always loaded;
  - the body is loaded when the skill triggers (under 500 lines and about 5k tokens);
  - reference files are loaded as needed.

  References stay **one level deep** from `SKILL.md`, with relative paths.

**Claude Code** (code.claude.com/docs/en/skills; the page shows no date).
- Install paths: project `.claude/skills/<name>/SKILL.md`, personal `~/.claude/skills/`, or through plugins.
- Invocation: automatic from the description, or `/<name>`. In `claude -p` only the first skill in a message is loaded.
- Limits: `description` + `when_to_use` are cut at 1,536 characters in the listing.
- Outside Claude Code (the API, claude.ai uploads) only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are accepted, and other keys are a hard error.
- **Decision:** the frontmatter uses only `name`, `description`, `license` and `metadata`, so the same file works everywhere. `check.mjs` enforces this.

**The `skills` installer**: npm `skills` 1.7.4 (modified 2026-10-19), from `github.com/vercel-labs/skills` (`docs/commands.md`, `docs/agents.md`, `docs/creating-skills.md`, `src/providers/wellknown.ts`).
- Sources: `owner/repo`, full GitHub/GitLab/Azure/git URLs, tree paths, local paths, and any `https://` URL (RFC 8615 well-known discovery, then a direct `SKILL.md` or archive download).
- **Well-known discovery** reads `<site>/.well-known/agent-skills/index.json` (fallback `/.well-known/skills/`), in two formats:
  - v0.2.0: `$schema` `https://schemas.agentskills.io/discovery/0.2.0/schema.json`, with `skill-md`/`archive` entries and a `sha256:` digest;
  - legacy: `{skills: [{name, description, files[]}]}`, with the files under `<path>/<name>/`.
- **Repository discovery:** the root `SKILL.md`, `skills/`, `.agents/skills/`, `.claude/skills/` and others, walked up to three levels.
- **Agent paths:**

  | Agent | Project | Global |
  |---|---|---|
  | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
  | `cursor` | `.agents/skills/` | `~/.cursor/skills/` |
  | `codex` | `.agents/skills/` | `~/.agents/skills/` |

- **Flags:** `-a`, `-s/--skill`, `-g`, `-y`, `--list`, `--copy`.
- It needs Node 22.20+ and has telemetry (`DISABLE_TELEMETRY=1`).
- **Decision:**
  - The public repository puts the skill at `skills/clikgate-setup/`.
  - The documented command is `npx skills add clikgate/clikgate-skills`.
  - The URL form `npx skills add https://clikgate.com` also works once the website serves the index. `build.mjs` writes it, in the legacy `files[]` format, which needs plain files only.
  - The URL form is 4 characters shorter. S.7 says to prefer it, so switch the dashboard and docs to it once W.2 serves `/.well-known/agent-skills/`. It isn't documented yet because it would fail today.
  - The installer wasn't run here: the sandbox blocked running a downloaded package. Its discovery rules were checked from its source instead.

**Cursor** (cursor.com/docs/context/skills and /rules; cursor.com refused connections, so this is from the search-indexed docs text).
- Skills are read from project `.agents/skills/` and `.cursor/skills/`, user `~/.agents/skills/` and `~/.cursor/skills/`, and, for compatibility, `.claude/skills/` and `.codex/skills/`.
- `disable-model-invocation: true` hides a skill from the agent.
- Project instructions: `AGENTS.md` in the project root (and `.cursor/rules`).

**Codex** (learn.chatgpt.com/docs/build-skills, the redirect target of developers.openai.com/codex/skills; developers.openai.com/codex/guides/agents-md).
- Skills come from `.agents/skills` in every folder from the working directory up to the repository root, `~/.agents/skills` and `/etc/codex/skills`.
- They're invoked with `$<skill>` or `/skills`, or implicitly from the description.
- `AGENTS.md` (or `AGENTS.override.md`) is read from the git root down to the working directory, with the files concatenated. The default cap is 32 KiB, and the chain is read once at startup.
- **Decision:** `ai-guides/plain/AGENTS.md` is a short block, not the whole guide: it points to `https://clikgate.com/docs/ai/setup.md`, so it stays under the cap.

**llms.txt** (llmstxt.org).
- Format: an H1 (the only required part), then a blockquote summary, optional detail, H2 sections of `[name](url): notes` lists, and an `## Optional` section.
- Pages also exist at the same URL plus `.md`.
- `llms-full.txt` isn't part of the proposal (it's a common convention). The spec asks for it, so `build.mjs` writes both, with links in the shape W.2 describes (`/docs/….md`).

**Claude Code CLI install for QA** (code.claude.com/docs/en/setup).
- `claude` was on PATH (`/opt/homebrew/bin/claude`, an npm install) but broken: "native binary not installed", because its optional per-platform dependency was missing.
- The official native installer (`curl -fsSL https://claude.ai/install.sh | bash`) failed with `EACCES … mkdir ~/.local/share`, because **`~/.local` is owned by root** on this Mac. The owner may want `sudo chown -R "$USER" ~/.local`; nothing here needs it.
- The documented npm method (`npm install -g @anthropic-ai/claude-code@latest`; the global prefix is user-owned, no sudo) installed **2.1.310**.
- It is signed in with the owner's claude.ai login, so `claude -p` works without an API key.

### Decisions

- **The AI flow:** ask first. Then offline mode with the test key:
  1. `--dry-run` (show the plan);
  2. `--yes`;
  3. `doctor --json --domain …`;
  4. fix every `fail`, then every `warn`.

  The JSON sample and check IDs in the guides come from `cli/schema/doctor-report.schema.json` and `cli/src/doctor*.ts` (in `clikgate_mobile_sdk` since 2026-10-26), and `check.mjs` checks them. `doctor --json` never signs in, so `clikgate.*` and `live.first_event` are left to the user's own signed-in run.
- **Shared domains:** the guide explains that opting in lists the app ID in a public file, recommends a custom subdomain, and tells the assistant to leave a shared domain out of `--domain` if the user declines. Offline mode itself adds the domain to the manifests, plus a dashboard step.
- **No IDFA claims:** the guides only forbid IDFA, ATT and fingerprinting code. `check.mjs` fails any IDFA mention that isn't a prohibition.
- **Web:** AI flows use the **test** site key (`cg_site_test_…`). `cg_site_test_` exists in the backend.
- **`api-surface.md` is generated from the SDK sources, not from dartdoc, typedoc, Dokka or the Swift symbol graph** (a change from S.7's "public API docs output").
  - *Reason:* those tools need Flutter, Gradle and Xcode, and there is no Mac in CI.
  - The generator reads only public declarations, strips comments, and skips `@ClikgateInternalApi`, `@_spi`, `objc_` and the wrapper hooks.
  - Node uses tsc's declaration output (`server/node/dist/esm/*.d.ts`), which *is* the docs output.
  - CI runs it with `--check` against `clikgate/clikgate-mobile-sdk`. The web-script section is kept as committed in CI, because the backend repository is private; regenerate it locally with `--web`.
- **Checked code blocks:** the tag is ` ```<lang> clikgate-check ` (S.7). Fragments (manifest lines, one method) stay untagged.
  - `ts` (Node and React Native, `tsc --noEmit` against the sources) and `swift` (parse, plus a local `--swift-typecheck` against a module built from `ios/Sources`): verified locally, and a deliberately invented method fails.
  - `dart` (`flutter analyze`) and `kotlin` (`kotlinc` against `android.jar` and the AAR's `classes.jar`): **CI only, not run here** (no Flutter or kotlinc on this Mac).
  - No Python, PHP, Java or C# blocks exist yet, because those SDKs don't. The HTTP example is untagged `sh`.
- **`versions.json` must equal what the setup command installs** (`clikgate_mobile_sdk/cli/src/constants.ts`, through `CLIKGATE_CLI_DIR`) and `server/node/package.json`. `check.mjs` fails otherwise. In `clikgate_mobile_sdk`, `scripts/check_cli_sdk_versions.mjs` checks the same constants against the SDKs themselves.
  - On 2026-10-26 the mobile SDKs moved to **Flutter 1.4.0, React Native 1.5.0, Android 1.4.0, iOS 1.4.0** (the shared-domain browser fallback, `onBrowserHandoff`).
  - `versions.json` follows them, so **the check fails until the CLI's `SDK` constants (and its snapshots) are bumped to `^1.4.0` / `^1.5.0` / `1.4.0` / `~> 1.4`.** This is deliberate: the guides and the setup command must name the same versions.
- **Distribution:** `ai-guides.yml` › `publish` (workflow_dispatch with `publish: true`, environment `skills`, secret `SKILLS_DEPLOY_KEY`, a write deploy key on `clikgate/clikgate-skills`) rsyncs `dist/clikgate-skills/` and pushes. S.7 says "on each SDK release". The SDK release workflows don't dispatch it yet: run it after a release, or add a `workflow_dispatch` call to the release workflows.
- **QA harness** (`ai-guides/qa/`):
  - fixtures are copied outside the repository;
  - the skill is installed into the copy's `.claude/skills/`;
  - sessions run with `claude -p` and `--setting-sources project`, no MCP, no WebFetch or WebSearch, `acceptEdits`, and an allow-list of Bash commands;
  - two PATH shims map `npx @clikgate/setup` and `npm install @clikgate/node` to the local builds until they're on npm;
  - prompts use the placeholder key `cg_sdk_test_x`.

  Results are in `docs/AI_GUIDES_QA.md`.
  - The first Node run edited files without showing a plan. The guide was fixed (`server-sdks.md` › Procedure), not the fixture, and the rerun passed.
  - Not isolated: personal skills in `~/.claude/skills` still load (`--bare` would skip them, but it needs an API key).

## Server SDKs (`server/`), C6-S4 and C6-S5: Python, PHP, Java and .NET

Built 2026-10-26, in that order. .NET was added after the .NET SDK (10.0.403) was installed on the dev Mac.

### Shared changes made with this part

- **Codegen filter: `x-clikgate-auth`** (coordinator request, 2026-10-26).
  - The backend now marks every operation with `x-clikgate-auth`: `api_key`, `dashboard_session`, `staff`, `public`, `sdk_key` or `cli`.
  - `filter.mjs` keeps the `api_key` operations only. The `docs/API.md` Auth-column parsing and `server/openapi/auth.json` are gone, which answers the earlier "suggestion to the backend".
  - Result from the regenerated `openapi.json`: **417 operations, 624 schemas, 229 skipped** (`server/openapi/filter-report.txt`).
  - All four languages were regenerated, Node's generated file included. `generate.mjs --check` passes for node, python, php and java, and `server-codegen.yml` now watches every generated output.
- **SPEC and cases checked against the built C6-B5 backend** (`clikgate_api/src/links/services/link_service.py`, `link_change_requests.py`, `docs/openapi.json`):
  - The `202` body is `LinkChangeRequestInfoResponse`. It has `requested_by_type`, `decision_note` and `livemode`, which the SPEC example lacked. The SPEC and the `changeRequest` fixture now match it, and `links.update.change_request` asserts the new fields.
  - `409 link_locked` matches; `param` is the first locked field.
  - The new codes `422 https_required` and `422 destination_not_allowlisted` (`param` = the URL field) were added to the SPEC table, with one case each.
  - `no_preview` matches: `LinkWarningResponse` on create and update when both `og_title` and `og_image_url` are empty.
  - `link.destination_changed` carries `data.object` (the link) plus `from`, `to`, `actor {type, id, api_key_prefix, requested_by?, change_request_id?}`, `actor_type` and `api_key_prefix`. It is documented in SPEC section 20, with a signed-event case.
  - **The suite now has 282 cases (was 279).** Node passes 280/280 after the regeneration (lint, typecheck and 20 unit tests also pass).
  - Per language, the counts exclude cases with a `languages` list: Python runs 275, PHP 273, Java 274 and .NET 273.
- **Node follow-up (not edited, per the rules):** `src/types.ts` `LinkChangeRequest` lacks `requested_by_type`, `decision_note` and `livemode`. Its index signature keeps them at runtime. `KnownErrorCode` lacks `https_required` and `destination_not_allowlisted`.

### Python (`server/python`, PyPI `clikgate`)

- **API shape:**
  - `Clikgate` (sync, thread-safe) and `AsyncClikgate` share one sans-I/O core: request preparation, the retry decision, queue bookkeeping, the guard and the warnings. Only the I/O loops are duplicated.
  - The conformance runner runs all 275 cases against **both** clients.
- **Background sending:**
  - The sync client uses one daemon thread per client, which runs jobs in order: batches, sync-mode sends and flushes. At most one batch is in flight. The thread restarts after `os.fork()` (gunicorn preload).
  - The async client uses one task on the running loop. `AsyncClikgate.goal()` outside a running loop reports `no_running_loop` to `on_error`. At exit, the async client only logs what's unsent; the docs say `await close()` in the lifespan.
- **Options:**
  - Keyword-only. An unknown option raises `ConfigurationError invalid_option`, as SPEC 3 requires, through `**unknown`. The cost is that a typo isn't caught by mypy.
  - `timeout` is in seconds. httpx applies it per phase (connect, read, write), not as one total.
- **Clock seam:** `Clock.now()`, `sleep()` and `async_sleep()` use **seconds**, the Python idiom (SPEC 18 states milliseconds for Node). The runner records the sleeps in milliseconds.
- **Money:** `float` and `bool` raise `TypeError`; inside `goal()` they reach `on_error` as `invalid_value`. `Decimal` uses `format(d, "f")`.
- **Dates:** a naive `datetime` is refused (`invalid_argument`), because guessing the timezone would shift events.
- **Errors:** `PermissionError` and `TimeoutError` are Clikgate's own classes, as SPEC 2 requires. They shadow the built-ins only when imported from `clikgate`.
- **Add-ons:**
  - Django: `ClikgateMiddleware`, sync and async capable. `get_client()` is built from `settings.CLIKGATE`. Django's `HttpResponse` can't hold two `Set-Cookie` headers, so `persist()` uses `response.set_cookie(…)` with the same attributes (`httponly=False`); Django adds `expires`.
  - Flask: the `Clikgate(app)` extension.
  - Starlette/FastAPI: a pure ASGI middleware, plus the `click_id` dependency.
- **Generated layer** (`src/clikgate/api.py`, 18k lines):
  - Models are functional `TypedDict`s (`total=False`). `NotRequired` needs Python 3.11, and `typing_extensions` would be a second dependency.
  - Sync and async classes; `ApiClient` and `AsyncApiClient`.
- **Typing:** mypy strict passes on `src`, `tests` and `examples`. mypy 2.4 can't target 3.9, so the check targets 3.10. Python 3.9 compatibility is shown by running the suite on 3.9 instead.
- **Packaging:**
  - hatchling, wheel and sdist, `license = "MIT"` (PEP 639).
  - The build requirement is `hatchling>=1.27,<2`, not a pin: hatchling 1.32 needs Python 3.10, which broke source installs on 3.9. This was found by the 3.9 run.
- **Verified locally:**
  - Python 3.14.2: ruff check, ruff format, mypy strict, 19 unit tests, and conformance 275/275 sync plus 275/275 async.
  - Python 3.9.6: 18 passed and 1 skipped (FastAPI isn't installed on 3.9), plus 275/275 for each client.
  - The wheel check passed, and the CycloneDX 1.6 SBOM listed httpx and its transitive dependencies.

### PHP (`server/php` `clikgate/clikgate-php`, `server/php-laravel` `clikgate/clikgate-laravel`)

- **Dependencies:** `psr/http-client`, `psr/http-factory`, `psr/http-message`, `psr/log` (`^2 || ^3`; 1.x has untyped signatures that a PHP 8 logger can't extend) and `php-http/discovery`.
- **Transport:**
  - PSR-18 has no timeout or proxy API. The SDK therefore sends with **ext-curl** when it is loaded: a per-attempt `CURLOPT_TIMEOUT_MS`, the proxy with `CURLOPT_PROXY`, and libcurl's own `https_proxy`/`NO_PROXY` handling.
  - Without curl, it uses any PSR-18 client found by discovery.
  - A PSR-18 `httpClient` option is honoured as is. Its timeout and proxy are the client's.
- **Send modes:**
  - `sync` (default), `after_response` and `background`. SPEC section 3 lists `background | sync` for every SDK, plus `after_response` for PHP, and the conformance cases run `background` in PHP.
  - PHP has no timers: a batch goes when the queue reaches `batchSize`, on `flush()` and at shutdown.
- **Money:** floats always throw `\InvalidArgumentException`. The SDK can't see whether the caller uses `strict_types`, so SPEC 8's non-strict branch (warn and convert) isn't implemented.
- **Results:**
  - Arrays (the wire JSON), like Node and Python.
  - `ClikgateException::getErrorCode()`, because `Exception::getCode()` is final and an int.
  - The generated layer (`src/Generated/*`) also takes and returns arrays; docblocks name the schema.
- **Click IDs:**
  - Requests: PSR-7, Symfony/Laravel `Request`, `['url', 'headers']`, or `null` (globals).
  - Responses: PSR-7 responses are immutable, so `persist()` returns the new response.
  - With a Symfony response, the cookie is re-rendered by `ResponseHeaderBag` (it adds `expires`).
- **Laravel:**
  - Auto-discovered provider, `Clikgate` facade (via `ClikgateManager`), `clikgate` middleware alias (`Router::aliasMiddleware`) and the `Request::macro('clikgateClickId')`.
  - `CLIKGATE_QUEUE` dispatches a `SendGoal` job (5 tries, backoff 10/30/120/600 s; 4xx fail at once).
  - **`EncryptCookies::except(['_cg_cgid'])`**: otherwise Laravel would encrypt the cookie the web script must read.
  - It reads the raw `Cookie` header for the same reason.
  - Laravel 11, 12 and 13, on PHP 8.2+ (Laravel 11's minimum). Superseded in 2.0.0: Laravel 12 and 13 only (see "clikgate-laravel 2.0.0 drops Laravel 11" below).
  - The path repository to `../php` is added in CI (`composer config repositories…`), not committed, because the split public repository has no `../php`.
- **Verified locally (PHP 8.5.12):**
  - PHPStan **max** (level 10) is clean on `src` (including `Generated`), `tests/Unit` and `examples`; php-cs-fixer (PER-CS 2.0) is clean.
  - 10 PHPUnit tests and conformance **273/273**.
  - Laravel 13.38 with testbench 11: 4 tests; PHPStan max is clean.
  - CycloneDX 1.6 SBOM (`composer run sbom`) lists the 5 runtime packages.
  - PHP 8.1 is covered in CI only.

### Java (`server/java`, `server/java-spring-boot-starter`, Maven `com.clikgate:*`)

- **Artifacts:**
  - `clikgate-java`: Java 8, bytecode 52, checked with `javap`.
  - `clikgate-servlet-javax`: Servlet 4.0.1 API, provided.
  - `clikgate-servlet-jakarta`: compiled against Jakarta Servlet **5.0.0** so it stays Java 8; it is binary-compatible with 6.x.
  - `clikgate-spring-boot-starter`: Spring Boot 4.1.2, Java 17.
  - All four share one reactor and one parent POM (`clikgate-java-parent`, also published).
- **Built-in HTTP/1.1 transport (`SocketTransport`)** instead of `HttpURLConnection`:
  - Java 8's `HttpURLConnection` can't send `PATCH` (and reflection hacks fail on 16+).
  - It doesn't send `Proxy-Authorization` on CONNECT tunnels (`jdk.http.auth.tunneling.disabledSchemes`).
  - `java.net.http` needs Java 11.
  - It does TLS with hostname verification and SNI, has one deadline per attempt, keep-alive (4 idle per host, 30 s), reads chunked and fixed-length bodies, and follows no redirects.
  - The proxy comes from the option or from `https.proxyHost`/`http.nonProxyHosts`.
  - `Transport` is public, so OkHttp or Apache can be plugged in.
- **Jackson databind 2.22.4:** the classes are major 52 (checked with `javap`). Jackson 3 needs Java 17.
- **JSpecify:** `@Nullable` (TYPE_USE) is used, but not `@NullMarked`. Its `@Target` includes `ElementType.MODULE`, so `javac --release 8` warns "unknown enum constant", and that can't be suppressed under `-Werror`.
- **Results:** typed models (`GoalEvent`, `Link`, `LinkUpdateResult`, …) wrap the wire map and expose `toMap()`. The generated layer takes and returns Maps/Lists.
- **Money:** `BigDecimal` (`toPlainString`, scale kept), `long`, and also a decimal `String`, because the conformance `money.format.string.*` cases run for Java too. There are no `double`/`float` overloads.
- **Logging:** SLF4J when present (MDC `clikgate_code`), else JUL. SLF4J is an optional dependency, so it isn't transitive.
- **Spring:**
  - A `Clikgate` bean with `destroyMethod = "close"` and JVM hooks off; the context lifecycle flushes.
  - A `FilterRegistrationBean` using the jakarta `ClikgateFilter`, `@ClikgateClickId` (an argument resolver) and `ClikgateContext.currentClickId()` (`RequestContextHolder`).
  - The Boot 4 BOM manages Jackson 2 at 2.21.7, so starter users get the Boot-managed Jackson.
- **Verified locally (JDK 17.0.17, Maven 3.10.0):**
  - `-Xlint:all -Werror` on every module.
  - Unit tests: core 8, javax 2, jakarta 2, starter 3. Conformance **274/274**.
  - `-P release` builds javadoc and sources jars (doclint on); `-P sbom` writes CycloneDX 1.6 per module.
  - Java 8, 11, 21, 25 and 27 are covered in CI with `-Dsurefire.jvm`.

### .NET (`server/dotnet`, NuGet `Clikgate` and `Clikgate.AspNetCore`)

- **Target frameworks:**
  - `Clikgate`: `netstandard2.0;net8.0;net10.0`. `Clikgate.AspNetCore`: `net8.0;net10.0` (ASP.NET Core has no netstandard).
  - S.9 asks for .NET Standard 2.0 and .NET 8. net10.0 is added because it is the current LTS and runs to 2028-11-14.
  - .NET 8 and 9 reach end of support on **2026-11-10**. net8.0 is kept because it is still supported today and is S.9's floor. Drop it only in a future major version.
  - .NET 11 is at RC 3 (go-live) and isn't targeted yet.
  - netstandard2.0 covers .NET Framework 4.6.2 (supported until 2027-01-12) and 4.7–4.8.1.
- **Dependencies:** none on net8.0/net10.0. `System.Text.Json` 10.0.14 on netstandard2.0 only; it brings `Microsoft.Bcl.AsyncInterfaces` and friends transitively. `scripts/check-version.sh` enforces this.
- **No `ILogger` in the core.** `Microsoft.Extensions.Logging.Abstractions` would break "none on .NET 8".
  - The core has an `IClikgateLogger` seam; its default writes warnings and errors to `Trace`.
  - `Clikgate.AspNetCore` adapts `ILogger` (category `Clikgate`, the warning code as the `EventId` name).
- **API names:**
  - `ClikgateClient : IClikgateClient` (spec quick start `new ClikgateClient()`), with `ClikgateOptions` (properties) and the `SendMode`/`PrivateMode` enums.
  - `Goal()` enqueues and never throws. `GoalAsync()` sends and awaits, and never throws either (SPEC 2's `Goal()`/`GoalAsync()` pair).
  - `Goals.SendAsync`, `SendBatchAsync` and `ReverseAsync`. `Links.*Async`, with `ListAsync` returning `IAsyncEnumerable<Link>`. `Clicks.GetAsync` and `Conversions.*Async`.
  - `FlushAsync`, `CloseAsync`, and `IAsyncDisposable`/`IDisposable`.
  - `Webhooks.Verify` and `VerifyAny` are static. `ClickIds.IsValid` is static; the other click-ID helpers are instance methods bound to the parameter.
  - The version constant is `SdkVersion.Value`, not `Version`, which would clash with `System.Version` under `using System;`.
- **Money:** `MoneyValue` converts implicitly from `decimal`, `long`, `int` and `string`; there is no `double`. `decimal.ToString(InvariantCulture)` keeps the scale. The string form exists because `money.format.string.*` runs for .NET too, as it does for Java.
- **HTTP:**
  - `HttpClient` with `AllowAutoRedirect = false`. The SDK applies the per-attempt timeout with a linked `CancellationTokenSource` (`HttpClient.Timeout` is infinite).
  - net8.0+ uses `SocketsHttpHandler` (5-minute pooled lifetime for DNS changes); netstandard2.0 uses `HttpClientHandler`.
  - `Proxy` takes an explicit URL with credentials (`WebProxy` + `NetworkCredential`). .NET sends them after the proxy's 407 challenge, not pre-emptively. `NoProxy` ignores the system proxy.
  - **SocketsHttpHandler silently re-sends a request on a second connection** when the first closes before any response byte. That was found by `errors.network`: the mock saw 2 requests with `max_retries = 0`.
    - The built-in handler's `ConnectCallback` refuses a second connection for the same request message, so only the SDK's retry policy (SPEC 6) re-sends.
    - A user-supplied `HttpClient` keeps .NET's behaviour. The README says to disable redirects.
- **Background sender:** one worker task per client runs jobs in order, with the flush-interval timer. There are no threads to keep the process alive. `AppDomain.ProcessExit` flushes for non-hosted apps, and the ASP.NET Core hosted service flushes in `StopAsync`.
- **ASP.NET Core:**
  - `builder.Services.AddClikgate(Action<ClikgateOptions>?)` binds the **`Clikgate` configuration section**. The scalar options are bound by hand, which keeps it trim-safe without the reflection binder. It registers an `IClikgateClient` (and `ClikgateClient`) singleton and the flush service.
  - `AddClikgate(IConfiguration section, …)` reads another section.
  - `app.UseClikgateClickId(ClickIdMiddlewareOptions?)` writes the cookie through `Response.OnStarting`.
  - `HttpContext.GetClikgateClickId()`. The extension lives in `Microsoft.AspNetCore.Http`, and `AddClikgate` in `Microsoft.Extensions.DependencyInjection`, following the library conventions.
- **Generated layer:** `clikgate.Api.<Resource>.<Operation>Async(...)` (e.g. `Api.Funnels.ListFunnelsAsync()`). It returns `Task<JsonNode?>`; bodies are `object?` (dictionaries or JsonNodes). The summaries are XML-escaped by mustache.
- **Tests:**
  - xunit.v3 4.0.2 on Microsoft.Testing.Platform. `global.json` opts in, because the .NET 10 SDK no longer runs VSTest for MTP projects, so CI runs `dotnet test --project …`.
  - `-p:TestTfms` picks the target frameworks: CI runs net8.0 and net10.0, plus **net472** on Windows for the netstandard2.0 build. Only the .NET 10 runtime is installed on the dev Mac.
- **Lint:** `TreatWarningsAsErrors`, `AnalysisLevel=latest`, `EnforceCodeStyleInBuild`, nullable enabled, the XML docs file generated (missing docs are errors), and `dotnet format --verify-no-changes`.
- **SBOM:** the CycloneDX .NET tool 6.3.1 is pinned in `.config/dotnet-tools.json`, run with `-F Json -spv 1.6 -ed`. `-ed` drops build-only packages such as ILLink. The SBOM lists System.Text.Json and its netstandard2.0 transitive packages.
- **Verified locally (.NET SDK 10.0.403, runtime 10.0.14):**
  - The Release build of the solution has no warnings.
  - 10 tests passed: 8 core, plus 2 ASP.NET Core tests (AddClikgate with the configuration section and the flush service, and the middleware cookie).
  - Conformance **273/273**.
  - `dotnet format` is clean.
  - Both packages pack with symbols and Source Link. The nuspec has no dependencies for net8.0/net10.0, and `System.Text.Json` for netstandard2.0.
- **Documentation findings (2026-10-26):**
  - .NET support policy (dotnet.microsoft.com/platform/support/policy/dotnet-core, releases-index.json):
    - .NET 8 (8.0.33) and .NET 9 (9.0.22) end on 2026-11-10. STS releases now get 24 months.
    - .NET 10 (10.0.14) ends on 2028-11-14.
    - .NET Framework lifecycle: learn.microsoft.com/lifecycle/products/microsoft-net-framework.
  - **NuGet trusted publishing exists** (announced 2025-09-22; learn.microsoft.com/nuget/nuget-org/trusted-publishing, updated 2026-09-01):
    - The policy fields are repository owner, repository, workflow file name and an optional environment.
    - `NuGet/login` v1.2.0 (`8d196754…`) exchanges the OIDC token for an API key valid for 1 hour.
    - Formal GA wording isn't stated on the page.
  - ID prefix reservation: email account@nuget.org (learn.microsoft.com/nuget/nuget-org/id-prefix-reservation).
  - `actions/setup-dotnet` v6.0.0 (`a98b5685…`).
  - Package versions: xunit.v3 4.0.2 (test projects net472+/net8.0+), xunit.runner.visualstudio 4.0.1, Microsoft.NET.Test.Sdk 18.11.0, System.Text.Json 10.0.14 (still ships netstandard2.0).

### Documentation findings (checked 2026-10-26; versions from the registries' APIs that day)

- **Python** (devguide.python.org/versions):
  - Supported: 3.11, 3.12 and 3.13 (security fixes), 3.14 and 3.15 (bug fixes; 3.15.0 was released 2026-10-09).
  - EOL: **3.9** (2025-10-31) and **3.10** (2026-10-01).
  - 3.9 stays the documented minimum (S.9) and in CI. Like Node 18, it can be dropped in a future major version.
  - Tool versions: httpx 0.28.1 (`>=3.8`), ruff 0.17.2, mypy 2.4.0 (runs on 3.10+), pytest 9.1.1 (3.10+; 8.4.2 on 3.9), build 1.6.1, hatchling 1.32.4 (3.10+), cyclonedx-bom 7.5.0.
  - Frameworks:
    - Django 6.1.2 (3.12+), using the `sync_capable`/`async_capable` and `markcoroutinefunction` pattern (docs.djangoproject.com/en/stable/topics/http/middleware/).
    - Flask 3.1.3, using `init_app`, `app.extensions` and `g` (flask.palletsprojects.com/en/stable/extensiondev/).
    - FastAPI 0.162.0 and Starlette 1.10.0 (3.11+). Pure ASGI middleware is recommended for libraries (starlette.dev/middleware/).
    - Starlette 1.10 warns that "`httpx` with `starlette.testclient` is deprecated; install `httpx2`". That affects only the tests, not the SDK.
- **PyPI trusted publishing** (docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/, adding-a-publisher/; github.com/pypa/gh-action-pypi-publish):
  - A pending publisher is created under Account → Publishing, with the project name, owner, repository, workflow file name and environment.
  - A pending publisher **does not reserve the name**.
  - `pypa/gh-action-pypi-publish` v1.14.3 (2026-10-20, `7245906f…`) makes **PEP 740 attestations by default** with trusted publishing.
  - The job needs `id-token: write`, scoped to the publish job.
- **PHP** (php.net/supported-versions.php):
  - 8.5 has active support until 2027-12-31; 8.4 has active support until 2026-12-31; 8.3 has security fixes until 2027-12-31; 8.2 has security fixes until 2026-12-31.
  - **8.1 has been EOL since 2025-12-31.** It is kept as the minimum (S.9) and in CI.
  - Tool versions: PHPStan 2.3.2 (levels 0–10, where `max` = 10), php-cs-fixer 3.95.27, PHPUnit 13.4 (PHP 8.4+), 12 (8.3+), 11 (8.2+) and 10 (8.1). The `require-dev` range resolves the right one per PHP version.
  - Laravel 13 (2026-03-17; PHP 8.3+). Laravel 12 has security fixes until 2027-02-24. Laravel 11 has been EOL since 2026-03-12; it stayed in the range for slower upgraders until 2.0.0 dropped it (see "clikgate-laravel 2.0.0 drops Laravel 11" below).
  - Package auto-discovery uses `extra.laravel` (laravel.com/docs/13.x/packages). `Router::aliasMiddleware` and the `Request` `Macroable` trait were checked in the 13.x source.
  - `cyclonedx/cyclonedx-php-composer` 6.2.0.
- **Packagist** (packagist.org/about, packagist.com/docs/api/trusted-publishing):
  - `composer.json` must be at the repository root, so the packages are published as split repositories.
  - Versions come from tags.
  - Updates arrive through the Packagist GitHub app or a webhook (`https://packagist.org/api/github?username=…`).
  - **There is no trusted publishing for public Packagist**; it exists only for Private Packagist.
- **Java** (endoflife.date/eclipse-temurin, oracle-jdk; docs.spring.io/spring-boot/system-requirements.html):
  - LTS releases are 8, 11, 17, 21 and 25. **JDK 27** (non-LTS) was released on 2026-09-15 (Temurin 27.0.1 on 2026-09-22), and 26 is EOL.
  - Spring Boot 4.1.2 needs Java 17, is tested up to Java 27, and needs Servlet 6.1. Spring Boot 4.0 is supported until 2026-12-31, and 3.5 support ended on 2026-06-30. The starter therefore targets Boot 4 only, and Java 8 Spring Boot 2/3 users can use the Servlet filter.
  - Auto-configuration is registered in `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.
  - Library versions: JUnit 6 needs Java 17, so the Java 8 modules test with JUnit **5.14.4**.
  - Maven plugin and library versions: jackson-databind 2.22.4, jakarta.servlet-api 6.1.0 (compiled against 5.0.0), javax.servlet-api 4.0.1, slf4j-api 2.0.20, jspecify 1.0.1, maven-compiler 3.16.0, surefire 3.6.1, javadoc 3.12.0, source 3.4.0, gpg 3.2.8, cyclonedx-maven-plugin 2.9.3.
- **Maven Central** (central.sonatype.org/publish/requirements/, publish-portal-maven/, news/20250326_ossrh_sunset/):
  - OSSRH was sunset on 2025-06-30, and the Central Portal replaces it.
  - Each release needs `-sources.jar` and `-javadoc.jar`, POM name, description, url, licenses, developers and scm, a `.asc` signature on every file, and md5/sha1 checksums (the plugin adds them).
  - The publishing plugin is `central-publishing-maven-plugin` 0.12.0 (2026-10-13) with `publishingServerId=central`, `autoPublish` and `waitUntil=published`.
  - The `settings.xml` server `central` uses the Portal user token.
  - Maven Central has no OIDC trusted publishing, so the token and the GPG key are environment secrets.
  - Namespace verification for `com.clikgate` uses a DNS TXT record in the Portal; the page wasn't re-read.
- **GitHub Actions pinned for these workflows** (GitHub releases API, 2026-10-26):

  | Action | Version | Released | Commit |
  |---|---|---|---|
  | actions/setup-python | v7.1.0 | 2026-10-22 | `6d4fd22b…` |
  | shivammathur/setup-php | 2.40.0 | 2026-10-08 | `eb7c497e…` |
  | actions/setup-java | v6.1.0 | — | `b843ebf9…` |
  | pypa/gh-action-pypi-publish | v1.14.3 | — | `7245906f…` |

  The others are as in the Node section. The workflows haven't been run, and actionlint isn't installed.

## Change 09: AI guides (2026-10-27)

- **App link subdomains (N.1, contract B2):** the guides teach `<link_subdomain>.ciz.to` (release) and
  `<link_subdomain>.dev.ciz.to` (debug) plus verified custom domains, and never a shared domain (`ciz.to`, `clk.ng`,
  `clkg.to`, `dev.ciz.to`). The shared-domain opt-in is gone (the backend ignores `shared_domain_app_links`).
  Examples use `acme.ciz.to` / `acme.dev.ciz.to` next to `go.acme.com`.
- **Web goals (N.2, contract B3):** `web.md` uses the publishable web key (`data-web-key`, `cgw_test_…`) on
  `sdk.clikgate.com`; `data-site-key` is no longer used by `clikgate.js`. Goals sent from a browser need "Allow
  from browser"; the guides tell the agent to ask before switching it on and never for payment goals.
- **`api-surface.md`** now includes `ClikgateMoney.ofMinor` per platform (read from the SDK sources, failing on
  drift), because the guides' rule is "if it isn't listed, it doesn't exist".
- **Wording (D9):** private mode is described for "businesses with strict security and privacy needs".

## Change 10 (2026-10-27)

- **Metadata filters are added in the codegen filter, not by hand per language.** The backend's `metadata[<key>]`
  query parameters are invisible in `openapi.json` (read from the raw query string). `codegen/filter.mjs` keeps a
  list of the five operations that read them (`METADATA_FILTER_OPERATIONS`) and adds one deepObject `metadata` map
  parameter, so every language's typed method gets it from the same source. The list must follow the backend's
  `metadata_filters` / `analytics_filters` dependencies; asking the backend to declare the parameter in
  `openapi.json` would let the list go.
- **Map query values are serialised by the transport** (`key[sub]=value`) in all five SDKs, so the hand-written
  `links.list` and the generated methods behave the same.
- **`subscription.updated` needs no type change:** webhook `type` stays a plain string (decided in Change 09), so new
  event types are documentation and a conformance case.

## Change 19 C19-S1 S.3: hashed identifiers (2026-11-04)

- **Strict phone input.** `hash_for_ads` needs the country code (`+` or `00`); a national number is
  `invalid_argument`, never guessed. The website samples strip non-digits only; for `+` input both give the same
  hashes (same vectors). The backend's `normalise_phone_digits` also drops leading zeros; the helper refuses a number
  that starts with 0 after the country prefix instead.
- **Uppercase hex is refused locally** (`invalid_hashed_identifier`, the backend's code), not lowercased.
- **Google's Gmail rule** (dots and `+suffix`) is not applied: R.5 defines `hashed_email` as trimmed + lowercased
  only (backend open question recorded in clikgate_api docs/ADS.md).
- **`customer` (raw email / phone) is unchanged**: still refused by the private-mode guard; outside private mode it
  goes through `extra` / conversion params as before.


## Change 21 C21-S R.41: the generator reads the public audience only (2026-11-05)

- **Input.** `generate.mjs --from <clikgate_api>` copies `docs/openapi-public.json` (backend workstream B6; `public` +
  `sdk` routes) to `server/openapi/openapi-public.json` and removes the vendored legacy `openapi.json`; a backend
  checkout without the public file falls back to `docs/openapi.json` as before. The generator reads the vendored
  public file when present, else the legacy one (`server/codegen/source.mjs`).
- **Filter.** When the document declares audiences, only `x-audience: public` operations (that are also
  `x-clikgate-auth: api_key`) are generated; `sdk` routes and operations without an audience are skipped. `/v1/staff`,
  `/internal` and `/v1/sdk` paths are never generated (checked last, so the legacy filter report is byte-identical).
  The input check now also fails on `x-audience` `staff`, `internal` or `webhook` operations.
- **Tests.** `server/codegen/filter.test.mjs` (7, `node --test`), added to the `server-codegen` workflow. The full
  regeneration is left to the lead (the generated headers still say "from openapi.json"; they change with it).
- **Versions.** `ai-guides/versions.json` follows the mobile SDK patch releases (Android, iOS, Flutter 1.5.1, React
  Native 1.6.1, setup 1.1.1); `api-surface.md` regenerated (it also picked up earlier drift: `blockMessage`,
  Node `keepRoute` / `context`) and `ai-guides/dist` rebuilt.


## Change 22 C22-B3 (S, I.1, R.9, R.27, R.44): server SDKs and AI guides (2026-11-08)

- **Generated API: removal applied in the generator, not by re-syncing.** The backend builder was still changing the
  goal and app-event routes, and `clikgate_api/docs/openapi-public.json` still listed the app events resource, the server
  event intake, the event-rule routes (all four forms) and the SDK events route. Re-syncing (`--from`) would have
  brought them back, so the vendored document is unchanged and `server/codegen/removed.mjs` drops those paths (and
  adds GoalStatus `received`) before filtering. It is idempotent: once the backend's public document has caught up it
  does nothing, and the next `generate.mjs --from ../clikgate_api` is the normal sync. `filter-report.txt` records
  counts only. **Re-run `node server/codegen/generate.mjs --from ../clikgate_api` after the backend's C22-B1 lands**
  to pick up its other schema changes (the funnel/progress `app_event` values, `measurement_partner_sends_app_events`,
  `app_event_webhook_names`, `goal-names`, aliases), which this change deliberately doesn't invent.
- **GoalStatus `received` (R.9).** Added to the shared enums in every language (generated). No send-path change was
  needed: every SDK already treated any 2xx goal answer as a result (never retried, never passed to `on_error`).
  Conformance `goals.send.status.received_not_counted_yet` and `goals.background.received_not_counted_yet` prove it in
  all five languages. The old `errors.410.goal_archived` case stays: it tests the generic 410 → `InvalidRequestError`
  mapping, which any 410 still follows.
- **`createIdentityToken` shape.** A function that needs no client or API key (Node `createIdentityToken`, Python
  `create_identity_token`, PHP `IdentityToken::create`, Java `IdentityTokens.create`, .NET `IdentityTokens.Create`),
  plus a client method that uses the client's own `identitySecret` / `identitySecrets` options (Laravel config keys,
  Spring properties, ASP.NET Core configuration). The function form also takes an explicit `secret` and `issuedAt` (for
  tests and odd setups); the client method doesn't take `secret`, so secrets come from configuration only.
- **The per-app map.** `CLIKGATE_IDENTITY_SECRETS` is a JSON object of app IDs to secrets (the spec said "a per-app
  map" without a format). With `appId`, that app's entry wins; an app not in the map falls back to the single
  `CLIKGATE_IDENTITY_SECRET` (a one-app server that passes `appId` anyway keeps working). Several apps and no `appId`
  and no single secret: `missing_identity_secret` with param `app_id`. A malformed map is `invalid_identity_secrets`,
  never echoed; Laravel reports it only when a token is created, so a bad value can't break `goal()`.
- **Customer ID rule.** 1-255 characters counted as Unicode code points, matching the backend's identify schema
  (`customer_user_id` max 255); no normalisation (the vectors include precomposed and decomposed é). PHP also refuses
  invalid UTF-8. Errors never contain the customer ID, token or secret.
- **Server-only detection (R.27).** Node: `window`, `document`, or `navigator.product === "ReactNative"`. Java:
  `android.os.Build` loads (checked once, cached). .NET: MAUI/Xamarin by OS platform (Android, iOS, tvOS, Mac Catalyst,
  watchOS) or loaded assembly (`Microsoft.Maui`, `Microsoft.Maui.Controls`, `Xamarin.Forms.Core`, `Xamarin.iOS`,
  `Xamarin.Mac`, `Mono.Android`, `Microsoft.iOS`/`Android`/`MacCatalyst`/`tvOS`), not `Microsoft.Maui.Graphics` alone
  (it runs on servers too); browser (Blazor WebAssembly) and WASI builds are refused as well, since the rule is "refuses
  browser and mobile builds". **Python is applicable after all:** Pyodide/Emscripten, WASI, and CPython's official iOS
  and Android builds (`sys.platform` `ios` / `android`, 3.13+) are refused. **PHP: not applicable** (no browser or mobile
  PHP runtime), so no check and no exception class.
- **Shared vectors.** `server/conformance/vectors/identity-token-vectors.json`, written by
  `server/conformance/tools/build_identity_token_vectors.py`, which loads the backend's own `sign_identity_token` from
  the sibling checkout (`--check` for drift). Non-ASCII text is stored as `\u` escapes so no editor can normalise it.
  Each language's unit tests read it directly (not through the conformance mock: the function makes no request).
- **AI guides.** The plan wording is the spec's sentence ("Events and goals work on every plan, up to the plan's
  allowance. Growth and up add re-engagement, Apple Ads, install fraud scoring, and uninstall tracking on Pro.");
  "needs Growth" troubleshooting replaced by the "Seen from your app and website" explanation; identity setup added
  (path A default, path B mentioned) in SKILL.md, goals.md, server-sdks.md (a compiled `ts clikgate-check` block) and
  plain/AGENTS.md. Non-Node server SDKs are still "not available yet" in the guides, so they get the token formula.
  `api-surface.md`: the four mobile `track` signatures were removed by hand, because the mobile SDK builder hadn't
  removed them from `clikgate_mobile_sdk` yet; **re-run `generate-api-surface.mjs --mobile ../clikgate_mobile_sdk`
  after the mobile C22 work lands** (it will also add `getInstallationId()`, and its `--check` CI step fails until
  then if the mobile sources still have `track`). `versions.json` unchanged (no SDK version moved: nothing is published).
- **Versions.** Server SDKs stay 1.1.0 (unreleased); the changelog entries record the removal in the pre-release
  history. Removing the generated app events resource would be breaking for a published version, but none exists.
- **CI guard.** `scripts/check_no_track.mjs` + `.github/workflows/no-track-guard.yml`, R.44 patterns exactly. Allowed by
  path: `docs/spec/`, ignored third-party/build directories, the vendored backend OpenAPI document, `removed.mjs` and its
  test, the guard. In a CHANGELOG.md only `- **Removed` lines; a test asserting a 404 can carry `no-track-guard: 404
  test`. It also checks that every server SDK README links to https://clikgate.com/docs/identify-users (I.8 "Also").
- **Internal rename.** Node's private `GoalQueue.track(promise)` (bookkeeping for sync sends, never public) is now
  `holdSend`, so no `track(` remains in SDK sources.

## Change 23 S (R.1, R.9): strict goal names in the server SDKs (2026-11-08)

Spec: `docs/spec/clikgate-change-23-unknown-goals-goal-groups.md` U, S, R.1, R.2, R.9 (R wins). Contract: `server/SPEC.md`
sections 5 (known codes, refusal body), 12.3, 15 (debug lines) and 23.2. No version bumped (entries under "Unreleased").
`server/codegen/generate.mjs` was **not** run (the backend OpenAPI is changing at the same time); `unknown_goal` reaches
the generated reason lists when the owner regenerates.

- **An error, like `payment_goal_needs_confirmation`.** R.1 says the refusal is `422` "like
  payment_goal_needs_confirmation", which the server SDKs already map to `InvalidRequestError` (SPEC 5, rule 12). So
  `unknown_goal` and `goal_archived` are errors, not `refused` results: `goals.send` throws, background/sync `goal()`
  pass them to `on_error` (dropped), batch items are per-item failures. 422 was already never retried and a whole-batch
  4xx already dropped, so the "final" rule needed no retry change.
- **Two body shapes accepted.** The backend isn't built yet, and R.1 shows the body as `{status: "refused", reason:
  "unknown_goal", counted: false, goal_kind: null}`. Every SDK accepts the usual error envelope (with or without those
  extra top-level fields) and, new, a body with **no** `error` object whose `status` is `refused` and `reason` a
  non-empty string: `code` = `reason`, `raw` = the body, `param`/`type` null. Before, that body gave `http_422`.
  Conformance covers both shapes, sync and background.
- **The debug line is debug level.** R.9 says "only when debug logging is on", and SPEC 15's default is warnings and
  above, so the line is logged at debug: Node calls `logger.debug` only if the logger has one (the default console
  logger has none); Python `logger.debug` (filtered by the `clikgate` logger's level); PHP PSR-3 `debug()`; Java a new
  `ClikgateLogger.debug(code, message)` **default** method (no-op, so custom loggers keep compiling; the built-in SLF4J
  and java.util.logging loggers implement it at debug / `FINE`); .NET `ClikgateLogLevel.Debug` (already in the enum).
  Text ``Goal `{name}` isn't set up in Clikgate``, code `unknown_goal`; the goal name only. Only `unknown_goal` gets it
  (the spec names one message); `goal_archived` is final but logs nothing new.
- **No name checks on the server SDK side.** Nothing stores refused names; the next call with the same name is sent
  (conformance `goals.send.refused.not_remembered`). The existing SPEC 12.3 `unknown_goal` **warning** (config-based,
  `privateMode: auto`) is kept: it is warn-only, never blocks and says "the API decides", so it doesn't conflict with
  R.9's "never check names on the device". It shares the code `unknown_goal` with the debug line; the warning is at
  warn level, the refusal line at debug level.
- **Laravel `SendGoal` job.** The only persisted queue in the server SDKs. It used to `fail()` every
  `InvalidRequestException`, which stores the job in `failed_jobs` where it can be retried by hand. For `unknown_goal` and
  `goal_archived` the job now ends without failing (dropped, never retried); other 4xx still fail the job.
- **Conformance cases** (tools/build-cases.mjs, `goals` suite, 8 new, 511 total): `goals.send.refused.unknown_goal`
  (envelope, `max_retries: 3`, one request, reference and value not in logs), `.unknown_goal_refusal_body`,
  `.goal_archived`, `.not_remembered`; `goals.background.refused.unknown_goal_item`, `.goal_archived_item`,
  `.whole_batch_refusal_body`; `goals.batch.refused.unknown_goal_item`. The judge has no "log line present" check
  (only `logs_exclude`), so the debug line itself is asserted in each SDK's unit tests rather than adding a new
  expectation every runner would need.
- **Not done here:** the AI guides (`ai-guides/`, built into `dist/`) don't mention `unknown_goal` yet; they're
  generated with the website docs work (C23-W1).


## Change 23 C23-W1: the AI guides (2026-11-08)

- `unknown_goal` / `goal_archived` (strict mode, live only, `422`, final) added where the guides cover `goal()` answers
  and troubleshooting: `SKILL.md` ("Or the server refuses unknown names"), `references/goals.md` (the answer paragraph,
  a Rules entry with what each sender returns, the archive row), `references/troubleshooting.md` (two rows),
  `references/server-sdks.md` (final, debug line for `unknown_goal` only), `references/payments.md` (an unknown name
  with `provider` and `reference` answers `unknown_goal`).
- Goal groups: the goals API table gains `/v1/goals/settings` and `/v1/goal-groups` (labels only; never changes
  counting or sending); troubleshooting explains the `goal_group` webhook/export field.
- The guides tell assistants never to check names on the device, cache the setting or create goals from app code.
- Rebuilt (`ai-guides/scripts/check.mjs`, `build.mjs`) and copied to the website with its `pnpm sync:ai-guides`.
  `api-surface.md` is generated from SDK sources and wasn't touched.

## clikgate-laravel 2.0.0 drops Laravel 11 (2026-11-09)

- **Decision (owner, 2026-11-09):** `clikgate/clikgate-laravel` 2.0.0 supports Laravel 12 and 13 only. This replaces
  "Laravel 11 stays in the range for slower upgraders" above.
- **Why:** every Laravel 11.x release now carries a security advisory (Laravel 11 has been EOL since 2026-03-12), so
  Composer 2.9+ refuses to install any of them by default. A supported range nobody can install safely isn't support.
- **Changes:** `illuminate/*` `^12.0 || ^13.0`, `orchestra/testbench` `^10.0 || ^11.0` (dev). The Laravel 11 CI row and its
  `audit.block-insecure` override are gone; the Laravel 12 row runs on PHP 8.2, so the package's PHP minimum (8.2+,
  Laravel 12's minimum too) is still tested. The core `clikgate/clikgate-php` keeps PHP 8.1+.
