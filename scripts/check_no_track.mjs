#!/usr/bin/env node
// Change 22 (S, R.44): fail if the removed app-event API creeps back into this repository, and check that every
// server SDK reference page links to the "Identify your users" guide (I.8).
//
//   node scripts/check_no_track.mjs              # scan the repository (git-tracked and new, non-ignored files)
//   node scripts/check_no_track.mjs --self-test  # prove the patterns match what they should, and only that
//
// Matches Clikgate identifiers only (R.44): a Clikgate track call, `trackEvent`, the removed webhook type and routes,
// and "Event rules" (case-sensitive). Allowed, by path: third-party code (dependencies are git-ignored and never
// scanned), docs/spec/ (the change specs), the vendored backend OpenAPI document (refreshed by the codegen sync), the
// codegen removal list and its test (they name the removed routes on purpose), and this file. In a CHANGELOG.md only
// the entry recording the removal ("- **Removed") may name them. Test files that assert the old routes answer 404
// are allowed with the marker `no-track-guard: 404 test` on the line.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const RULES = [
  { id: 'clikgate-track', re: /\bClikgate(\.shared)?\.track\b/ },
  { id: 'clikgate-track-call', re: /clikgate\.track\(/ },
  { id: 'trackEvent', re: /trackEvent/ },
  { id: 'app-event-webhook', re: /app_event\.received/ },
  { id: 'sdk-events-route', re: /\/v1\/sdk\/events\b/ },
  { id: 'app-events-route', re: /\/v1\/app-events\b/ },
  { id: 'event-rules', re: /Event rules/ },
];

/** Paths never scanned, with the reason. */
export const ALLOWED_PATHS = [
  [/^docs\/specs?\//, 'change specs'],
  [/(^|\/)(node_modules|vendor|\.venv|venv|target|bin|obj|dist|build|\.test-dist|\.cache|\.phpstan-cache)\//, 'third-party code and build output'],
  [/^server\/openapi\/openapi(-public)?\.json$/, 'the vendored backend OpenAPI document (server/codegen/removed.mjs drops the routes)'],
  [/^server\/codegen\/removed\.mjs$/, 'the codegen removal list'],
  [/^server\/codegen\/filter\.test\.mjs$/, 'the codegen test that proves the removal'],
  [/^scripts\/check_no_track\.mjs$/, 'this guard'],
  [/\.(png|jpe?g|gif|webp|ico|pdf|jar|zip|gz|tgz|nupkg|snupkg|woff2?)$/i, 'binary files'],
];

/** Server SDK reference pages that must link to the identify-users guide. */
export const SDK_PAGES = ['node', 'python', 'php', 'php-laravel', 'java', 'java-spring-boot-starter', 'dotnet'].map((d) => `server/${d}/README.md`);
const IDENTIFY_LINK = 'clikgate.com/docs/identify-users';

export function allowedPath(path) {
  return ALLOWED_PATHS.some(([re]) => re.test(path));
}

/** Findings for one file's text: [{line, rule, text}]. */
export function scanText(path, text) {
  const out = [];
  const isChangelog = /(^|\/)CHANGELOG\.md$/.test(path);
  text.split(/\r?\n/).forEach((line, i) => {
    if (isChangelog && /^\s*- \*\*Removed\b/.test(line)) return;
    if (line.includes('no-track-guard: 404 test')) return;
    for (const rule of RULES) {
      if (rule.re.test(line)) out.push({ line: i + 1, rule: rule.id, text: line.trim().slice(0, 160) });
    }
  });
  return out;
}

function listFiles() {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ls-files failed: ${r.stderr}`);
  return [...new Set(r.stdout.split('\0').filter(Boolean))].sort();
}

function scanRepo() {
  const findings = [];
  for (const path of listFiles()) {
    if (allowedPath(path)) continue;
    let text;
    try {
      text = readFileSync(join(root, path), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    if (text.includes('\0')) continue; // binary
    for (const f of scanText(path, text)) findings.push(`${path}:${f.line}: [${f.rule}] ${f.text}`);
  }
  for (const page of SDK_PAGES) {
    let text = '';
    try {
      text = readFileSync(join(root, page), 'utf8');
    } catch {
      findings.push(`${page}: missing (every server SDK has a reference page)`);
      continue;
    }
    if (!text.includes(IDENTIFY_LINK)) findings.push(`${page}: [identify-users-link] no link to https://${IDENTIFY_LINK}`);
  }
  return findings;
}

function selfTest() {
  const hits = (path, text) => scanText(path, text).map((f) => f.rule);
  const must = [
    ['Clikgate.track("signup")', 'clikgate-track'],
    ['Clikgate.shared.track("signup")', 'clikgate-track'],
    ['await clikgate.track(name)', 'clikgate-track-call'],
    ['fun trackEvent(name: String)', 'trackEvent'],
    ['subscribe to app_event.received', 'app-event-webhook'],
    ['POST /v1/sdk/events', 'sdk-events-route'],
    ['GET /v1/app-events?app_id=', 'app-events-route'],
    ['Open Event rules', 'event-rules'],
  ];
  const mustNot = [
    'this.queue.holdSend(p)',
    'analytics.track("Signed Up")', // Segment's own API, not Clikgate's
    'POST /v1/goals/events',
    'POST /v1/public/app-open-events',
    'event rules are gone', // lower case: not the product name
    'Clikgate.goal("purchase")',
    'trackers and tracking links',
  ];
  const fails = [];
  for (const [text, id] of must) if (!hits('src/a.ts', text).includes(id)) fails.push(`should match ${id}: ${text}`);
  for (const text of mustNot) if (hits('src/a.ts', text).length) fails.push(`should not match: ${text}`);
  if (hits('server/node/CHANGELOG.md', '- **Removed (generated API):** `GET /v1/app-events`').length) fails.push('the CHANGELOG removal entry must be allowed');
  if (!hits('server/node/README.md', '- **Removed:** `GET /v1/app-events`').length) fails.push('only CHANGELOG.md removal entries are allowed');
  if (!hits('server/node/CHANGELOG.md', '- **Added:** `GET /v1/app-events`').length) fails.push('other CHANGELOG lines are scanned');
  if (hits('tests/test_routes.py', 'assert get("/v1/app-events").status == 404  # no-track-guard: 404 test').length) fails.push('marked 404 tests must be allowed');
  if (!allowedPath('docs/spec/clikgate-change-22.md') || !allowedPath('server/node/node_modules/x/index.js') || allowedPath('server/node/src/client.ts')) fails.push('path allow-list is wrong');
  if (fails.length) {
    console.error(`check_no_track self-test failed:\n  ${fails.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`check_no_track self-test passed (${must.length + mustNot.length + 5} checks)`);
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const findings = scanRepo();
  if (findings.length) {
    console.error(`The removed app-event API (or a missing identify-users link) was found. Clikgate has one method, goal(); see server/SPEC.md section 26 for identity.\n${findings.join('\n')}`);
    process.exit(1);
  }
  console.log('check_no_track: clean (no track, app events, removed routes or "Event rules"; every SDK page links to identify-users)');
}
