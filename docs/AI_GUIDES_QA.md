# AI guides QA (Change 06 S.7)

The guide is the `clikgate-setup` skill in `ai-guides/`. This file records the Claude Code verification runs and holds the checklists the owner runs before launch: Cursor, Codex, and the on-device check.

## Claude Code (run by the builder)

**How:** `ai-guides/qa/run.sh [--out <dir>] [scenario …]`. For each scenario it:

1. copies a fixture to a fresh folder **outside the repository**;
2. installs the built skill into that folder's `.claude/skills/`;
3. starts a separate headless session there;
4. judges the result with `ai-guides/qa/evaluate.mjs`.

**Session settings:**

| Setting | Value |
|---|---|
| Command | `claude -p` with `--output-format stream-json` |
| Settings | `--setting-sources project`; no MCP servers (`--strict-mcp-config`) |
| Tools | `WebFetch` and `WebSearch` disabled, so only the installed skill is used |
| Permissions | `--permission-mode acceptEdits`, and Bash limited to read commands, `npx @clikgate/setup`, `npm install` and the typecheck |
| Runs | one at a time |

**The prompt:** the dashboard prompt (F.2), filled in with a test app, the placeholder key `cg_sdk_test_x` and link domains. Every run adds one sentence: "This is an unattended run… I approve in advance the changes you show me." The full prompts are in each run's `prompt.txt`.

**Shims:** `@clikgate/setup` and `@clikgate/node` aren't on npm yet, so `ai-guides/qa/shims/` sends `npx @clikgate/setup …` to the setup command's local build, `$CLIKGATE_CLI_DIR/dist/cli.cjs` (default `../clikgate_mobile_sdk/cli`; the command was in this repository's `cli/` when these runs were made), and `npm install @clikgate/node` to the packed tarball. Nothing else is intercepted:
- `@clikgate/react-native` really fails to install (404). The React Native and Expo runs recovered by following the guide's `--no-install` step.
- Flutter isn't installed on the Mac, so `flutter pub get` was skipped. The guide tells the user to run it.

**What is judged** (`result.json` › `checks`):

- **Every run:**
  - the skill was loaded;
  - no live SDK key and no API key in the changed files;
  - no IDFA, ATT or advertising-ID code;
  - no files deleted.
- **Apps:**
  - the setup command ran in offline mode with the test key;
  - `--dry-run` came before `--yes`;
  - `dev.ciz.to` was never passed in `--domain`;
  - the assistant ran doctor;
  - **our own** `doctor --json` on the result is `ok`;
  - the detected platform is right;
  - the final message passes on the signing-fingerprint and Team ID steps;
  - Flutter (which uses `ciz.to`): the shared-domain privacy note was explained.
- **Server (Node/Express):**
  - the assistant showed the plan before the first install or edit;
  - the dependency, import and click-ID middleware are present;
  - the goal `loan_approved` is sent with the application ID as the reference, no name or email, and no float conversion;
  - the key is read from the environment;
  - `npm run typecheck` passes (run by us and by the assistant).

The records (`result.json`, a readable `transcript.md`, `prompt.txt`, and the `commands.log` of every npx/npm call) are in [`docs/ai-qa-runs/2026-10-26/`](ai-qa-runs/2026-10-26/). The full outputs, including the changed projects and the raw stream-json, stayed in the builder's scratch folder.

### Results: 2026-10-26, Claude Code 2.1.310, model claude-opus-5-5

The `cli/test/fixtures/…` paths below were in this repository at the time; they are now `clikgate_mobile_sdk/cli/test/fixtures/…` (`<cli>/…` in `scenarios.json`).

| Scenario | Fixture | Result | Doctor (ours) | Files changed | Notes |
|---|---|---|---|---|---|
| Flutter | `cli/test/fixtures/flutter`, domains `ciz.to,go.example.com` | pass | ok, 11 passed | 6 modified, 2 added | Explained that `ciz.to` lists the app ID publicly and recommended the custom subdomain. Reminded about `onDeepLink` in the root widget and `flutter pub get` |
| React Native | `cli/test/fixtures/monorepo/apps/mobile` | pass | ok, 10 passed | 4 modified, 3 added | The npm 404 was recovered with `--no-install`, as the guide says |
| Expo | `cli/test/fixtures/expo-router` | pass | ok, 6 passed | 3 modified (`app.json`, `package.json`, `src/app/_layout.tsx`) | Told the user to make a new development build |
| Android | `cli/test/fixtures/android-compose` | pass | ok, 7 passed | 4 modified, 2 added (debug manifest, `ClikgateApplication.kt`) | Created `ClikgateApplication.kt`, and `MainActivity` gets `handleIntent` |
| iOS | `cli/test/fixtures/ios-uikit` (Podfile) | pass | ok, 7 passed | 4 modified, 2 added (Release and Debug entitlements) | File changes only (S.7). Told the user to run `pod install` and build once in Xcode |
| Node.js (Express) | `ai-guides/qa/fixtures/node-express` | pass (2nd run) | n/a | `server.ts`, `applications.ts`, `package.json`, `.env.example` | **1st run failed** `showed_plan_before_changing`: it installed and edited without showing a plan first. Fixed in the **guide**: `server-sdks.md` gained a "Procedure" whose step 2 is "Show the plan before changing anything". The rerun showed the diff, then applied it (record `node-express-run1/`) |

The cost was about $0.30 per run.
- Every app run used `--dry-run`, then `--yes`, then `doctor --json`.
- No run put a live key or an API key in code, or added `dev.ciz.to` to a release build.
- **Python, PHP, Java and .NET:** their SDKs aren't built yet, so there was no framework run for them. Add one scenario per language to `ai-guides/qa/scenarios.json` when each SDK ships (S.7: "one server SDK framework per language").
- **Rerun** after any guide change: `ai-guides/qa/run.sh`. It needs `claude` signed in (`claude auth status`).

## On-device "first event" check: owner to confirm

- [ ] Take the Flutter run's result (or run the setup command on a real app), fill in a real **test** SDK key and a live domain in the dashboard, and add the signing fingerprints / Team ID.
- [ ] Install a **debug** build on an Android device and on an iPhone.
- [ ] Create a test link to `clikgate-test:inspect`, open it on each device, and confirm the app opens.
- [ ] Run `npx @clikgate/setup doctor` (signed in) and confirm "Clikgate is receiving events from Android ✓" and "… iOS ✓".
- [ ] Confirm a release build does **not** open `dev.ciz.to` links.

## Cursor: owner to check before launch

Fixture: a copy of `clikgate_mobile_sdk/cli/test/fixtures/flutter` (or any app), **outside** the repositories.

- [ ] Install: `npx skills add clikgate/clikgate-skills -a cursor` (after the first publish), or copy `ai-guides/dist/clikgate-skills/skills/clikgate-setup` to `.agents/skills/` (built with `node ai-guides/scripts/build.mjs`).
- [ ] The skill shows in Cursor's skills list (Settings › Rules), and isn't hidden from the agent.
- [ ] In Agent chat, paste the prompt from `docs/ai-qa-runs/2026-10-26/flutter/prompt.txt` without the last "unattended" sentence, using a real **test** key and domain.
- [ ] The agent asks before running `npx @clikgate/setup`, or uses offline mode with `--dry-run` first.
- [ ] It shows the plan and asks before applying.
- [ ] It runs `npx @clikgate/setup doctor --json …` and fixes failures until `ok` is true.
- [ ] It explains the shared-domain note if `ciz.to` is used.
- [ ] It passes on the manual steps: fingerprints, Team ID, and the dashboard switch.
- [ ] No live key in code. `dev.ciz.to` only in debug files.
- [ ] Without the skill: add `ai-guides/plain/AGENTS.md` to the project's `AGENTS.md` and repeat (needs https://clikgate.com/docs/ai/setup.md to be live).

## Codex: owner to check before launch

The same fixture and prompt as Cursor.

- [ ] Install: `npx skills add clikgate/clikgate-skills -a codex` (or copy to `.agents/skills/`). `/skills` lists `clikgate-setup`.
- [ ] Run with the prompt, mentioning `$clikgate-setup` once and once without it (implicit match).
- [ ] The same boxes as Cursor: asks or previews, applies after a yes, doctor `ok`, shared-domain note, manual steps, no live key, `dev.ciz.to` debug-only.
- [ ] Without the skill: the `AGENTS.md` lines and the hosted `setup.md`.
- [ ] If the Codex CLI is available headless (`codex exec`), record the transcript next to the Claude Code runs in `docs/ai-qa-runs/`.
