#!/usr/bin/env node
// Validates the AI guides (ai-guides/). No dependencies; Node 18+. It checks:
//  1. SKILL.md frontmatter against the Agent Skills format (agentskills.io/specification; Anthropic's limits).
//  2. Every relative link in the skill resolves to a file inside the skill folder.
//  3. Every {{versions.*}} placeholder exists in versions.json, and versions.json matches what the setup
//     command installs (<cli>/src/constants.ts) and the server SDK's package.json.
//  4. Every `npx @clikgate/setup …` command uses only a subcommand and flags shown by the CLI's --help.
//  5. Every doctor check ID mentioned exists in the CLI source, and the doctor JSON sample uses only
//     fields from <cli>/schema/doctor-report.schema.json.
//  6. Safety: no real-looking keys, no old domains, IDFA mentioned only to forbid it.
// Usage: node ai-guides/scripts/check.mjs [--cli <path to cli.cjs>]
//
// <cli> is the setup command's folder, which lives in the clikgate_mobile_sdk repository (cli/): set
// CLIKGATE_CLI_DIR to it, or keep the default, the sibling checkout ../clikgate_mobile_sdk/cli. Build it
// first (cd <cli> && npm ci && npm run build); --cli defaults to <cli>/dist/cli.cjs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');            // ai-guides/
const repo = path.resolve(root, '..');
const skillDir = path.join(root, 'clikgate-setup');
const args = process.argv.slice(2);
const cliDir = path.resolve(process.env.CLIKGATE_CLI_DIR || path.join(repo, '..', 'clikgate_mobile_sdk', 'cli'));
if (!fs.existsSync(path.join(cliDir, 'src', 'constants.ts'))) {
  console.error(`setup command not found at ${cliDir}: check out clikgate_mobile_sdk next to clikgate_sdks, or set CLIKGATE_CLI_DIR to its cli/ folder`);
  process.exit(1);
}
const cliPath = args.includes('--cli') ? args[args.indexOf('--cli') + 1] : path.join(cliDir, 'dist', 'cli.cjs');

const errors = [];
const fail = (file, msg) => errors.push(`${path.relative(repo, file)}: ${msg}`);

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const skillFiles = walk(skillDir).filter((f) => f.endsWith('.md'));
const guideFiles = [...skillFiles, ...walk(path.join(root, 'plain')).filter((f) => f.endsWith('.md')), path.join(root, 'public', 'README.md')].filter((f) => fs.existsSync(f));
const text = Object.fromEntries(guideFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));

// ---------- 1. Frontmatter
{
  const file = path.join(skillDir, 'SKILL.md');
  const src = text[file];
  if (!src) fail(file, 'missing');
  else if (!src.startsWith('---\n')) fail(file, 'frontmatter must start on line 1 with ---');
  else {
    const end = src.indexOf('\n---\n', 4);
    if (end < 0) fail(file, 'frontmatter is not closed with ---');
    const fm = parseFrontmatter(src.slice(4, end));
    const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
    for (const k of Object.keys(fm)) if (!allowed.has(k)) fail(file, `frontmatter key "${k}" isn't in the Agent Skills format (allowed: ${[...allowed].join(', ')})`);
    const name = fm.name;
    if (typeof name !== 'string' || !name) fail(file, 'frontmatter needs a name');
    else {
      if (name.length > 64) fail(file, 'name is longer than 64 characters');
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) fail(file, 'name must be lowercase letters, digits and single hyphens');
      if (name !== path.basename(skillDir)) fail(file, `name "${name}" must match the folder name "${path.basename(skillDir)}"`);
      if (/anthropic|claude/.test(name)) fail(file, 'name must not contain the reserved words "anthropic" or "claude"');
    }
    const d = fm.description;
    if (typeof d !== 'string' || !d.trim()) fail(file, 'frontmatter needs a description');
    else {
      if (d.length > 1024) fail(file, `description is ${d.length} characters (max 1024)`);
      if (/[<>]/.test(d)) fail(file, 'description must not contain XML tags or angle brackets');
      if (!/\buse (it|this skill|when)\b/i.test(d)) fail(file, 'description should say when to use the skill ("Use it when …")');
    }
    if (typeof fm.compatibility === 'string' && fm.compatibility.length > 500) fail(file, 'compatibility is longer than 500 characters');
    const bodyLines = src.slice(end + 5).split('\n').length;
    if (bodyLines > 500) fail(file, `SKILL.md body is ${bodyLines} lines (keep it under 500; move detail to references/)`);
  }
}

// ---------- 2. Links
for (const file of skillFiles) {
  for (const m of stripCode(text[file]).matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
    if (!resolved.startsWith(skillDir + path.sep)) fail(file, `link ${target} points outside the skill folder`);
    else if (!fs.existsSync(resolved)) fail(file, `link ${target} doesn't exist`);
  }
}
{
  // Progressive disclosure: every reference file is reachable from SKILL.md (one level deep).
  const skill = text[path.join(skillDir, 'SKILL.md')] ?? '';
  for (const f of skillFiles) {
    const rel = path.relative(skillDir, f);
    if (rel !== 'SKILL.md' && !skill.includes(`](${rel})`)) fail(f, `isn't linked from SKILL.md`);
  }
}

// ---------- 3. Versions
const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
for (const [file, src] of Object.entries(text)) {
  for (const m of src.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    const key = /^versions\.([a-z_]+)$/.exec(m[1]);
    if (!key) fail(file, `unknown placeholder {{${m[1]}}} (only {{versions.<key>}} is supported)`);
    else if (!(key[1] in versions)) fail(file, `{{${m[1]}}} isn't in versions.json`);
  }
}
{
  const constants = fs.readFileSync(path.join(cliDir, 'src', 'constants.ts'), 'utf8');
  const grab = (re) => re.exec(constants)?.[1];
  const expect = {
    setup: grab(/CLI_VERSION = '([^']+)'/),
    flutter: grab(/flutter: \{[^}]*constraint: '\^([^']+)'/),
    react_native: grab(/reactNative: \{[^}]*constraint: '\^([^']+)'/),
    android: grab(/android: \{[^}]*version: '([^']+)'/),
    ios: grab(/ios: \{[^}]*version: '([^']+)'/),
    ios_pod: grab(/podConstraint: '~> ([^']+)'/),
    node: JSON.parse(fs.readFileSync(path.join(repo, 'server', 'node', 'package.json'), 'utf8')).version,
  };
  for (const [k, v] of Object.entries(expect)) {
    if (versions[k] !== v) fail(path.join(root, 'versions.json'), `"${k}" is ${versions[k]}, but the setup command / SDK uses ${v}`);
  }
}

// ---------- 4. Commands against --help
let help = '';
try {
  help = execFileSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
} catch (e) {
  errors.push(`couldn't run ${path.relative(repo, cliPath)} --help (build the CLI first: cd ${path.relative(process.cwd(), cliDir) || '.'} && npm ci && npm run build): ${e.message}`);
}
if (help) {
  const helpFlags = new Set(help.match(/(?<![\w-])--?[a-z][a-z-]*/g));
  const subcommands = new Set([...help.matchAll(/npx @clikgate\/setup (\w+) \[options\]/g)].map((m) => m[1]));
  let count = 0;
  for (const [file, src] of Object.entries(text)) {
    for (const m of codeOf(src).matchAll(/npx @clikgate\/setup([^`\n|]*)/g)) {
      count++;
      const tokens = m[1].replace(/[)"'.,;:]+\s*$/, '').trim().split(/\s+/).filter(Boolean);
      for (const [i, t] of tokens.entries()) {
        if (t.startsWith('-')) {
          const flag = t.split('=')[0];
          if (!helpFlags.has(flag)) fail(file, `\`npx @clikgate/setup${m[1]}\`: ${flag} isn't in the CLI's --help`);
        } else if (i === 0 && /^[a-z]+$/.test(t) && !subcommands.has(t)) {
          fail(file, `\`npx @clikgate/setup ${t}\`: "${t}" isn't a subcommand in the CLI's --help`);
        }
      }
    }
  }
  if (count === 0) errors.push('no `npx @clikgate/setup` commands found: the check is broken');
}

// ---------- 5. Check IDs and doctor JSON fields
{
  const src = ['doctor.ts', 'doctorCommand.ts', 'setup.ts'].map((f) => fs.readFileSync(path.join(cliDir, 'src', f), 'utf8')).join('\n');
  const patterns = new Set();
  for (const m of src.matchAll(/\bid:\s*(['`])([^'`]+)\1/g)) patterns.add(m[2].replace(/\$\{[^}]+\}/g, '*'));
  for (const m of src.matchAll(/const id = `([^`]+)`/g)) patterns.add(m[1].replace(/\$\{[^}]+\}/g, '*'));
  const asRegex = (p) => new RegExp('^' + p.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+') + '$');
  const known = [...patterns];
  const groups = /^(project|sdk|startup|android|ios|expo|clikgate|live)\./;
  for (const [file, s] of Object.entries(text)) {
    for (const m of s.matchAll(/`([a-z_]+\.[A-Za-z0-9_.<>|\\]+)`/g)) {
      const id = m[1];
      if (!groups.test(id) || /\.(md|json|ts|tsx|dart|kt|swift|xml|plist|gradle|yaml|kts|pbxproj|entitlements)$/.test(id)) continue;
      const norm = id.replace(/<[^>]+>/g, '*');
      const ok = known.includes(norm) || known.some((p) => asRegex(p).test(norm));
      if (!ok) fail(file, `check ID \`${id}\` isn't produced by the CLI (${path.relative(repo, path.join(cliDir, 'src'))})`);
    }
  }
  const schema = JSON.parse(fs.readFileSync(path.join(cliDir, 'schema', 'doctor-report.schema.json'), 'utf8'));
  const skill = text[path.join(skillDir, 'SKILL.md')] ?? '';
  const sample = [...skill.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes('"schema_version"'));
  if (!sample) fail(path.join(skillDir, 'SKILL.md'), 'no doctor JSON sample found');
  else {
    let parsed;
    try {
      parsed = JSON.parse(sample);
    } catch (e) {
      fail(path.join(skillDir, 'SKILL.md'), `the doctor JSON sample isn't valid JSON: ${e.message}`);
    }
    if (parsed) checkKeys(parsed, schema, schema, 'doctor', path.join(skillDir, 'SKILL.md'));
  }
  // Statuses named in the guides
  for (const [file, s] of Object.entries(text)) {
    for (const m of s.matchAll(/`status`[^.\n]*?\(([^)]*)\)/g)) {
      for (const st of m[1].match(/`(\w+)`/g) ?? []) if (!['`pass`', '`warn`', '`fail`', '`skip`'].includes(st)) fail(file, `unknown check status ${st}`);
    }
  }
}

// ---------- 6. Safety
for (const [file, src] of Object.entries(text)) {
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const where = `line ${i + 1}`;
    if (/cg_(sdk_)?(live|test)_[A-Za-z0-9]{6,}/.test(line)) fail(file, `${where}: looks like a real key; use a placeholder like cg_sdk_test_…`);
    if (/cg_sdk_live_[A-Za-z0-9]/.test(line)) fail(file, `${where}: a live SDK key value`);
    if (/clik\.gt|path[ _]proxy|test\.ciz\.to/i.test(line)) fail(file, `${where}: old domain or removed feature`);
    if (/\bIDFA\b/.test(line) && !/\b(no|never|don't|doesn't|not|nor|none)\b/i.test(line)) fail(file, `${where}: mention IDFA only to forbid it`);
    if (/\bguarantee|never blocked|100% safe/i.test(line)) fail(file, `${where}: banned claim`);
    if (/\b\d+\s*(seconds?|minutes?)\b.*\bset ?up\b|\bset ?up\b.*\b\d+\s*minutes?\b/i.test(line)) fail(file, `${where}: no setup time claims`);
  });
}

if (errors.length) {
  console.error(`AI guides check failed (${errors.length}):\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log(`AI guides check passed (${guideFiles.length} files).`);

// ---------- helpers

function parseFrontmatter(block) {
  const out = {};
  let parent = null;
  for (const raw of block.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const nested = /^\s+([\w-]+):\s*(.*)$/.exec(raw);
    const top = /^([\w-]+):\s*(.*)$/.exec(raw);
    if (top) {
      const v = unquote(top[2]);
      out[top[1]] = v === '' ? {} : v;
      parent = v === '' ? top[1] : null;
    } else if (nested && parent) {
      out[parent][nested[1]] = unquote(nested[2]);
    } else {
      throw new Error(`frontmatter line not understood: ${raw}`);
    }
  }
  return out;
}

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/** Only the code: fenced blocks and inline code spans, one per line. */
function codeOf(s) {
  const blocks = [...s.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const spans = [...s.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  return [...blocks, ...spans].join('\n');
}

function stripCode(s) {
  return s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

function resolveRef(node, rootSchema) {
  if (node && node.$ref) {
    const p = node.$ref.replace(/^#\//, '').split('/');
    return p.reduce((n, k) => n[k], rootSchema);
  }
  return node;
}

function checkKeys(value, schemaNode, rootSchema, where, file) {
  schemaNode = resolveRef(schemaNode, rootSchema);
  if (!schemaNode) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkKeys(v, schemaNode.items, rootSchema, `${where}[${i}]`, file));
    return;
  }
  if (value && typeof value === 'object') {
    const props = schemaNode.properties ?? {};
    for (const k of Object.keys(value)) {
      if (!(k in props)) fail(file, `doctor JSON sample: ${where}.${k} isn't in the doctor report schema`);
      else checkKeys(value[k], props[k], rootSchema, `${where}.${k}`, file);
    }
  }
}
