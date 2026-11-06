#!/usr/bin/env node
// Judges one Claude Code verification run (see run.sh). Usage:
//   node evaluate.mjs <run dir> <scenario JSON> <cli.cjs>
// <run dir> holds project/ (after the run), pristine/ (the fixture before it), transcript.jsonl (stream-json)
// and commands.log (every npx/npm call, from the shims). Writes <run dir>/result.json and transcript.md.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const [dir, scenarioJson, cli] = process.argv.slice(2);
const sc = JSON.parse(scenarioJson);
const project = path.join(dir, 'project');
const pristine = path.join(dir, 'pristine');
const IGNORE = new Set(['.claude', 'node_modules', '.clikgate-setup-backup', 'Pods', '.dart_tool', 'build', 'package-lock.json']);

// ---- transcript
const events = fs.existsSync(path.join(dir, 'transcript.jsonl'))
  ? fs.readFileSync(path.join(dir, 'transcript.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
  : [];
const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
const final = [...events].reverse().find((e) => e.type === 'result') ?? {};
const texts = [];
const md = [`# Transcript: ${sc.id}`, '', `Model: ${init.model ?? '?'} · Claude Code ${init.claude_code_version ?? '?'} · skills: ${(init.skills ?? []).join(', ') || '?'}`, ''];
for (const e of events) {
  if (e.type === 'user' && typeof e.message?.content === 'string') md.push('## Prompt', '', e.message.content, '');
  if (e.type === 'assistant') {
    for (const c of e.message?.content ?? []) {
      if (c.type === 'text') { texts.push(c.text); md.push('**Assistant:**', '', c.text, ''); }
      if (c.type === 'tool_use') md.push(`**Tool ${c.name}:** \`${JSON.stringify(c.input).slice(0, 400)}\``, '');
    }
  }
  if (e.type === 'user' && Array.isArray(e.message?.content)) {
    for (const c of e.message.content) {
      if (c.type === 'tool_result') {
        const body = Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('\n') : String(c.content ?? '');
        md.push('<details><summary>result</summary>', '', '```', body.slice(0, 3000), '```', '</details>', '');
      }
    }
  }
}
if (final.result) md.push('## Final message', '', final.result, '');
fs.writeFileSync(path.join(dir, 'transcript.md'), md.join('\n'));
const allText = [...texts, final.result ?? ''].join('\n');
const toolUses = events.flatMap((e) => (e.type === 'assistant' ? (e.message?.content ?? []).filter((c) => c.type === 'tool_use') : []));
const skillUsed = toolUses.some((t) => t.name === 'Skill' && /clikgate-setup/.test(JSON.stringify(t.input))) || toolUses.some((t) => /clikgate-setup\/(SKILL|references)/.test(JSON.stringify(t.input)));

// ---- file changes
const walk = (root, rel = '') =>
  fs.existsSync(path.join(root, rel))
    ? fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap((e) => (IGNORE.has(e.name) ? [] : e.isDirectory() ? walk(root, path.join(rel, e.name)) : [path.join(rel, e.name)]))
    : [];
const before = new Set(walk(pristine));
const after = new Set(walk(project));
const added = [...after].filter((f) => !before.has(f)).sort();
const deleted = [...before].filter((f) => !after.has(f)).sort();
const modified = [...after].filter((f) => before.has(f) && !fs.readFileSync(path.join(project, f)).equals(fs.readFileSync(path.join(pristine, f)))).sort();
const removedLines = {};
for (const f of modified) {
  const d = spawnSync('diff', ['-u', path.join(pristine, f), path.join(project, f)], { encoding: 'utf8' }).stdout;
  const removed = d.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  if (removed.length) removedLines[f] = removed.map((l) => l.slice(1).trim()).slice(0, 10);
}
const changedText = [...added, ...modified].map((f) => ({ f, s: fs.readFileSync(path.join(project, f), 'utf8') }));

// ---- rules
const checks = [];
const check = (id, pass, detail) => checks.push({ id, pass: Boolean(pass), ...(detail ? { detail } : {}) });
const log = fs.existsSync(path.join(dir, 'commands.log')) ? fs.readFileSync(path.join(dir, 'commands.log'), 'utf8').split('\n').filter(Boolean) : [];
check('skill_used', skillUsed, skillUsed ? undefined : 'the session never loaded the clikgate-setup skill');
const liveKey = changedText.find(({ s }) => /cg_sdk_live_[A-Za-z0-9]|cg_(live|test)_[A-Za-z0-9]{3,}/.test(s));
check('no_live_or_api_keys_in_code', !liveKey, liveKey?.f);
const idfa = changedText.find(({ s }) => /ASIdentifierManager|advertisingIdentifier|ATTrackingManager|NSUserTrackingUsageDescription|AdvertisingIdClient/.test(s));
check('no_idfa_or_fingerprinting', !idfa, idfa?.f);
check('no_files_deleted', deleted.length === 0, deleted.join(', ') || undefined);

let doctor = null;
if (sc.kind === 'app') {
  // Only what comes after the package name: `npx -y` is npx's own flag, not the setup command's --yes.
  const setupCalls = log.filter((l) => /@clikgate\/setup/.test(l)).map((l) => l.replace(/^.*?@clikgate\/setup(@\S+)?/, 'setup'));
  const firstApply = setupCalls.findIndex((l) => !/\bdoctor\b/.test(l) && /--yes|\s-y(\s|$)/.test(l));
  const firstDry = setupCalls.findIndex((l) => /--dry-run/.test(l));
  check('ran_setup_command', setupCalls.some((l) => !/\bdoctor\b/.test(l)), setupCalls.join(' | ') || 'never ran it');
  check('previewed_before_applying', firstApply < 0 ? false : firstDry >= 0 && firstDry < firstApply, `dry-run #${firstDry}, apply #${firstApply}`);
  check('used_test_key_offline_mode', setupCalls.some((l) => /--sdk-key cg_sdk_test_/.test(l)));
  check('did_not_pass_test_domain', !setupCalls.some((l) => /--domain[ =][^ ]*dev\.ciz\.to/.test(l)));
  check('ran_doctor', setupCalls.some((l) => /\bdoctor\b/.test(l)));
  const r = spawnSync(process.execPath, [cli, 'doctor', '--json', '--no-wait', '--cwd', project, '--domain', sc.domains], { encoding: 'utf8' });
  try {
    doctor = JSON.parse(r.stdout);
  } catch {
    doctor = { ok: false, error: (r.stderr || r.stdout).slice(0, 500) };
  }
  const failed = (doctor.checks ?? []).filter((c) => c.status === 'fail').map((c) => c.id);
  check('doctor_ok', doctor.ok === true, failed.join(', ') || doctor.error);
  check('platform_detected', doctor.project?.platform === sc.expect.platform, doctor.project?.platform);
  const needsFingerprints = sc.expect.platform !== 'ios';
  const needsTeamId = sc.expect.platform !== 'android';
  check('told_user_manual_steps', (!needsFingerprints || /fingerprint/i.test(allText)) && (!needsTeamId || /team id/i.test(allText)));
  if (sc.expect.sharedDomainNote) check('explained_shared_domain', /public/i.test(allText) && /subdomain/i.test(allText) && /ciz\.to/.test(allText));
} else {
  // Rule 1: before the first install or edit, an assistant message that shows the plan (files or code).
  const ordered = events.flatMap((e) => (e.type === 'assistant' ? e.message?.content ?? [] : []));
  const firstChange = ordered.findIndex((c) => c.type === 'tool_use' && (['Edit', 'Write'].includes(c.name) || /npm (install|i) /.test(c.input?.command ?? '')));
  const planBefore = ordered.slice(0, firstChange < 0 ? ordered.length : firstChange).some((c) => c.type === 'text' && /```|src\/server\.ts|package\.json/.test(c.text));
  check('showed_plan_before_changing', planBefore);
  const src = changedText.filter(({ f }) => f.startsWith('src/'));
  const code = src.map(({ s }) => s).join('\n');
  const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  check('dependency_added', Boolean(pkg.dependencies?.['@clikgate/node']), JSON.stringify(pkg.dependencies));
  check('imports_sdk', /from ['"]@clikgate\/node(\/express)?['"]/.test(code));
  check('keeps_click_id_middleware', /clikgateMiddleware\s*\(/.test(code) || /clickIds\.fromRequest\s*\(/.test(code));
  const goalCall = /(goal|goals\.send)\(\s*['"]loan_approved['"][\s\S]{0,400}?\)\s*;?/.exec(code)?.[0] ?? '';
  check('sends_loan_approved', Boolean(goalCall), goalCall.slice(0, 200) || undefined);
  check('reference_is_business_id', /reference:\s*[\w.]*\.id\b/.test(goalCall));
  check('no_customer_data_in_goal', goalCall && !/email|applicantName|\bname\b|phone/i.test(goalCall), goalCall.slice(0, 200));
  check('value_not_float', goalCall && !/parseFloat|Number\(|\*\s*100/.test(goalCall));
  check('api_key_from_env', !/apiKey:\s*['"]cg_/.test(code));
  const tc = spawnSync('npm', ['run', 'typecheck'], { cwd: project, encoding: 'utf8', env: { ...process.env, PATH: process.env.CLIKGATE_QA_REAL_PATH ?? process.env.PATH } });
  check('typecheck_passes', tc.status === 0, tc.status === 0 ? undefined : (tc.stdout + tc.stderr).slice(-800));
  check('ran_typecheck', toolUses.some((t) => /npm run typecheck|tsc/.test(JSON.stringify(t.input))));
}

const result = {
  scenario: sc.id,
  pass: checks.every((c) => c.pass),
  model: init.model ?? null,
  claude_code_version: init.claude_code_version ?? null,
  turns: final.num_turns ?? null,
  duration_ms: final.duration_ms ?? null,
  cost_usd: final.total_cost_usd ?? null,
  stop: final.subtype ?? null,
  checks,
  doctor: doctor && { ok: doctor.ok, summary: doctor.summary, failed: (doctor.checks ?? []).filter((c) => c.status !== 'pass').map((c) => ({ id: c.id, status: c.status, title: c.title })) },
  files: { added, modified, deleted, removed_lines: removedLines },
  setup_commands: log,
};
fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`${sc.id}: ${result.pass ? 'PASS' : 'FAIL'}  ${checks.filter((c) => !c.pass).map((c) => c.id).join(', ')}`);
