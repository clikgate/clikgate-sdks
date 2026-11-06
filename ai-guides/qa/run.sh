#!/usr/bin/env bash
# Claude Code verification runs for the AI guides (Change 06 S.7). Each scenario:
#   1. copies a fixture into a fresh folder OUTSIDE this repository (default: $TMPDIR/clikgate-ai-qa), so the
#      session can't see the specs, the SDK sources or this repository;
#   2. installs the built clikgate-setup skill into that copy's .claude/skills/;
#   3. starts a fresh, separate headless session there (`claude -p`) with only the dashboard prompt (F.2),
#      filled in with a test app and the placeholder key cg_sdk_test_x (never a real key);
#   4. judges the result (evaluate.mjs): doctor --json, files changed, the guide's rules, and the transcript.
# Runs go one at a time. Results: <out>/<scenario>/{result.json,transcript.md,transcript.jsonl,commands.log}
# and <out>/summary.md.
#
# Usage: ai-guides/qa/run.sh [--out <dir>] [--model <model>] [scenario …]   (default: every scenario)
# Needs: node 18+, the `claude` CLI signed in (`claude auth status`), network for npm (Express fixture),
# and the setup command, which lives in clikgate_mobile_sdk/cli: CLIKGATE_CLI_DIR, default the sibling
# checkout ../clikgate_mobile_sdk/cli. Its test fixtures are the app fixtures (`<cli>/…` in scenarios.json).
# Until @clikgate/setup and @clikgate/node are on npm, shims/ point `npx @clikgate/setup` and
# `npm install @clikgate/node` at the local builds. Nothing else is intercepted.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cli_dir="${CLIKGATE_CLI_DIR:-$repo/../clikgate_mobile_sdk/cli}"
[ -f "$cli_dir/package.json" ] || { echo "setup command not found at $cli_dir: check out clikgate_mobile_sdk next to clikgate_sdks, or set CLIKGATE_CLI_DIR" >&2; exit 1; }
cli_dir="$(cd "$cli_dir" && pwd)"
export CLIKGATE_CLI_DIR="$cli_dir"
out="${TMPDIR:-/tmp}/clikgate-ai-qa"
model=""
only=()
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --model) model="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) only+=("$1"); shift ;;
  esac
done
case "$out" in "$repo"/*|"$(dirname "$cli_dir")"/*) echo "--out must be outside the repositories" >&2; exit 1 ;; esac

command -v claude >/dev/null || { echo "claude is not on PATH: install Claude Code (https://code.claude.com/docs/en/setup)" >&2; exit 1; }
claude auth status >/dev/null 2>&1 || { echo "claude isn't signed in: run \`claude\` once and log in, or set ANTHROPIC_API_KEY" >&2; exit 1; }

mkdir -p "$out"
out="$(cd "$out" && pwd)"
pkgs="$out/.pkgs"
mkdir -p "$pkgs"

echo "== building the setup command, the Node SDK and the skill"
# Built only when missing, so a run never rewrites another build in progress.
(cd "$cli_dir" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && { [ -f dist/cli.cjs ] || npm run build >/dev/null; })
(cd "$repo/server/node" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && { [ -f dist/esm/index.js ] || npm run build >/dev/null; } && npm pack --ignore-scripts --pack-destination "$pkgs" >/dev/null)
node "$repo/ai-guides/scripts/check.mjs"
node "$repo/ai-guides/scripts/build.mjs" --out "$pkgs/dist" >/dev/null
cli="$cli_dir/dist/cli.cjs"
node_tgz="$(ls "$pkgs"/clikgate-node-*.tgz | tail -1)"
skill="$pkgs/dist/clikgate-skills/skills/clikgate-setup"

real_npx="$(command -v npx)"
real_npm="$(command -v npm)"
real_path="$PATH"
scenarios="$repo/ai-guides/qa/scenarios.json"
ids=$(node -e 'const s=require(process.argv[1]);console.log(s.scenarios.map(x=>x.id).join(" "))' "$scenarios")
[ ${#only[@]} -gt 0 ] && ids="${only[*]}"

for id in $ids; do
  sc=$(node -e '
    const s = require(process.argv[1]); const x = s.scenarios.find((y) => y.id === process.argv[2]);
    if (!x) { console.error("unknown scenario " + process.argv[2]); process.exit(1); }
    const fill = (t) => t.replace(/\{(\w+)\}/g, (_, k) => x[k]);
    x.fullPrompt = (x.prompt ? x.prompt : fill(s.appPrompt)) + "\n\n" + s.unattended;
    console.log(JSON.stringify(x));' "$scenarios" "$id")
  fixture="$(node -e 'console.log(JSON.parse(process.argv[1]).fixture)' "$sc")"
  case "$fixture" in "<cli>/"*) fixture="$cli_dir/${fixture#<cli>/}" ;; *) fixture="$repo/$fixture" ;; esac
  prompt="$(node -e 'console.log(JSON.parse(process.argv[1]).fullPrompt)' "$sc")"
  run="$out/$id"
  echo "== $id"
  rm -rf "$run" && mkdir -p "$run/project" "$run/pristine" "$run/project/.claude/skills"
  cp -R "$fixture/." "$run/project/"
  cp -R "$fixture/." "$run/pristine/"
  cp -R "$skill" "$run/project/.claude/skills/"
  if [ -f "$run/project/package.json" ] && [ "$(node -e 'console.log(JSON.parse(process.argv[1]).kind)' "$sc")" = server ]; then
    (cd "$run/project" && "$real_npm" install --no-audit --no-fund >/dev/null)
  fi
  printf '%s\n' "$prompt" > "$run/prompt.txt"
  : > "$run/commands.log"

  args=(-p "$prompt" --output-format stream-json --verbose
    --permission-mode acceptEdits
    --allowedTools "Read" "Glob" "Grep" "Edit" "Write" "Skill" "TodoWrite"
      "Bash(npx @clikgate/setup:*)" "Bash(npx -y @clikgate/setup:*)" "Bash(npx --yes @clikgate/setup:*)"
      "Bash(npm install:*)" "Bash(npm i:*)" "Bash(npm run typecheck:*)" "Bash(npx tsc:*)"
      "Bash(ls:*)" "Bash(cat:*)" "Bash(find:*)" "Bash(grep:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(diff:*)" "Bash(wc:*)"
    --disallowedTools "WebFetch" "WebSearch"
    --strict-mcp-config --mcp-config '{"mcpServers":{}}'
    --setting-sources project
    --max-turns 80)
  [ -n "$model" ] && args+=(--model "$model")

  start=$(date +%s)
  (
    cd "$run/project"
    PATH="$here/shims:$real_path" \
    CLIKGATE_QA_CLI="$cli" CLIKGATE_QA_NODE_TGZ="$node_tgz" \
    CLIKGATE_QA_REAL_NPX="$real_npx" CLIKGATE_QA_REAL_NPM="$real_npm" CLIKGATE_QA_LOG="$run/commands.log" \
    claude "${args[@]}" > "$run/transcript.jsonl" 2> "$run/stderr.log"
  ) || echo "   (claude exited with $?)"
  echo "   $(( $(date +%s) - start ))s"
  CLIKGATE_QA_REAL_PATH="$real_path" node "$here/evaluate.mjs" "$run" "$sc" "$cli" | sed 's/^/   /'
done

node -e '
  const fs = require("fs"), path = require("path");
  const out = process.argv[1];
  const rows = fs.readdirSync(out).filter((d) => fs.existsSync(path.join(out, d, "result.json"))).map((d) => JSON.parse(fs.readFileSync(path.join(out, d, "result.json"), "utf8")));
  const lines = ["# AI guide QA runs", "", `Run on ${new Date().toISOString()} with Claude Code ${rows[0]?.claude_code_version ?? "?"} (${rows[0]?.model ?? "?"}).`, "",
    "| Scenario | Result | Failed checks | Doctor | Turns | Time | Cost |", "|---|---|---|---|---|---|---|"];
  for (const r of rows) lines.push(`| ${r.scenario} | ${r.pass ? "pass" : "FAIL"} | ${r.checks.filter((c) => !c.pass).map((c) => c.id).join(", ") || "none"} | ${r.doctor ? (r.doctor.ok ? "ok" : "not ok") + " " + JSON.stringify(r.doctor.summary ?? {}) : "n/a"} | ${r.turns ?? "?"} | ${Math.round((r.duration_ms ?? 0) / 1000)} s | ${r.cost_usd != null ? "$" + r.cost_usd.toFixed(2) : "?"} |`);
  fs.writeFileSync(path.join(out, "summary.md"), lines.join("\n") + "\n");
  console.log(lines.join("\n"));' "$out"
