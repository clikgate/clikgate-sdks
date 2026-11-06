#!/usr/bin/env node
// Release scan (change 12, S.4): a released package carries no internal comments, TODO/FIXME notes, debug code,
// internal or staff URLs, or staff-only references. Run it on what is published: the npm tarball, the wheel and
// sdist, the Composer archive, the jars (including -sources and -javadoc) and the nupkg/snupkg.
//
//   node server/scripts/scan-package.mjs <file or directory>...
//   node server/scripts/scan-package.mjs --self-test
//
// Archives (.tgz, .tar.gz, .tar, .zip, .whl, .jar, .nupkg, .snupkg) are unpacked with the system tar / unzip into a
// temporary folder. Text files are checked line by line. Binary files (.class, .dll, .pyc, …) are checked through
// their printable ASCII and UTF-16LE strings, for the URL and reference rules. Exit 1 when anything is found.
// Zero dependencies (Node 18+).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';

/**
 * Rules. `code: true` rules only look at code lines of source files (not comments, docs or Markdown), because the
 * doc examples legitimately print things. `binary: true` rules also run on the strings of binary files.
 */
export const RULES = [
  { id: 'note', binary: true, re: /\b(?:TODO|FIXME|HACK)\b|\bXXX\b/, why: 'a TODO / FIXME / HACK / XXX note' },
  {
    id: 'debug',
    code: true,
    re: /\bdebugger\s*;|\bconsole\.(?:log|debug|trace|dir)\(|\bbreakpoint\(\)|\bpdb\.set_trace\(|^\s*print\(|\bvar_dump\(|\bprint_r\(|(?<![\w$>:])dd\(|\bSystem\.(?:out|err)\.print|\.printStackTrace\(\)|\bConsole\.Write(?:Line)?\(|\bDebugger\.(?:Break|Launch)\(/,
    why: 'debug code',
  },
  {
    id: 'internal-url',
    binary: true,
    re: /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(?:7010|7020|8000|8100|5432|5433|6379)\b|\bhttps?:\/\/[a-z0-9.-]+\.(?:internal|local|lan|corp)\b|\b(?:staff|admin|internal|staging|stage|ops)\.clikgate\.com\b|\bclikgate\.com\/staff\b|\bhttp:\/\/(?:[a-z0-9-]+\.)*clikgate\.com\b/i,
    why: 'an internal URL (local services, internal hosts, the staff console)',
  },
  { id: 'staff', binary: true, re: /\/v1\/staff\b|\bstaff[ -](?:console|only|tool(?:s|ing)?|route)s?\b/i, why: 'a staff-only reference' },
  {
    id: 'internal-ref',
    binary: true,
    re: /\bclikgate_(?:api|frontend|website|mobile_sdk)\b|\bdistyla\b|\/Users\/|\/private\/tmp\b|\bscratchpad\b|\bsrc\/[a-z_]+\/(?:services|routers|utils|schemas|models|repositories|providers)\/[\w/]+\.py\b|\b[Bb]ackend (?:contract|spec)\b|\bC\d{1,2}-[A-Z]{1,2}\d\b|\bX\.E\d+\b|\b[Cc]hange \d{2}\b|\bPart \d, \d+\b|\bcoordinator\b|\bowner item\b/,
    why: 'an internal reference (repositories, local paths, backend source paths, internal plans and milestones)',
  },
];

const ARCHIVES = ['.tgz', '.tar', '.zip', '.whl', '.jar', '.nupkg', '.snupkg'];
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.py', '.php', '.java', '.kt', '.cs']);
const MAX_PER_FILE = 5;

const isArchive = (p) => p.endsWith('.tar.gz') || ARCHIVES.includes(extname(p).toLowerCase());

function unpack(file, into) {
  const lower = file.toLowerCase();
  const r = lower.endsWith('.tgz') || lower.endsWith('.tar.gz') || lower.endsWith('.tar') ? spawnSync('tar', ['-xf', file, '-C', into]) : spawnSync('unzip', ['-qq', '-o', file, '-d', into]);
  if (r.status !== 0) throw new Error(`could not unpack ${file}: ${(r.stderr || '').toString().trim() || `exit ${r.status}`}`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() ? [p] : [];
  });
}

/** Printable ASCII and UTF-16LE runs of at least 6 characters, one per "line". */
function binaryStrings(buf) {
  const out = [];
  let cur = '';
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
    else {
      if (cur.length >= 6) out.push(cur);
      cur = '';
    }
  }
  if (cur.length >= 6) out.push(cur);
  for (const start of [0, 1]) {
    cur = '';
    for (let i = start; i + 1 < buf.length; i += 2) {
      const c = buf[i];
      if (buf[i + 1] === 0 && c >= 0x20 && c < 0x7f) cur += String.fromCharCode(c);
      else {
        if (cur.length >= 6) out.push(cur);
        cur = '';
      }
    }
    if (cur.length >= 6) out.push(cur);
  }
  return out;
}

/** The code lines of a source file: comment lines, block comments and Python docstrings are left out. */
function codeLines(lines, ext) {
  const keep = new Array(lines.length).fill(false);
  let inBlock = false;
  let inDoc = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (ext === '.py') {
      if (inDoc) {
        if (t.includes(inDoc)) inDoc = null;
        continue;
      }
      const m = /^(?:[rbuRBU]{0,2})("""|''')/.exec(t);
      if (m) {
        if (t.indexOf(m[1], m.index + m[0].length) < 0) inDoc = m[1];
        continue;
      }
      if (t.startsWith('#')) continue;
      keep[i] = true;
      continue;
    }
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) continue;
    keep[i] = true;
  }
  return keep;
}

/** Scan one file's content. Returns findings `{line, rule, text}`. */
export function scanContent(name, buf) {
  const findings = [];
  const ext = extname(name).toLowerCase();
  const binary = buf.subarray(0, 8192).includes(0);
  if (binary) {
    for (const s of binaryStrings(buf)) {
      for (const rule of RULES) if (rule.binary && rule.re.test(s)) findings.push({ line: 0, rule: rule.id, text: s });
    }
    return findings;
  }
  const lines = buf.toString('utf8').split(/\r?\n/);
  const code = CODE_EXT.has(ext) && !name.endsWith('.d.ts') ? codeLines(lines, ext) : null;
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.code && !(code && code[i])) continue;
      if (rule.re.test(line)) findings.push({ line: i + 1, rule: rule.id, text: line.trim() });
    }
  });
  return findings;
}

function scanPath(target, label = target) {
  const results = [];
  const st = statSync(target);
  if (st.isDirectory()) {
    for (const f of walk(target)) {
      const rel = `${label}/${relative(target, f)}`;
      if (isArchive(f)) results.push(...scanArchive(f, rel));
      else results.push(...scanContent(f, readFileSync(f)).map((x) => ({ ...x, file: rel })));
    }
    return results;
  }
  if (isArchive(target)) return scanArchive(target, label);
  return scanContent(target, readFileSync(target)).map((x) => ({ ...x, file: label }));
}

function scanArchive(file, label) {
  const dir = mkdtempSync(join(tmpdir(), 'clikgate-scan-'));
  try {
    unpack(file, dir);
    return scanPath(dir, label);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function selfTest() {
  const bad = [
    ['a.ts', '// TODO: remove'],
    ['a.ts', 'console.log(x);'],
    ['a.py', 'print("x")'],
    ['a.php', 'var_dump($x);'],
    ['a.java', 'e.printStackTrace();'],
    ['a.cs', 'Console.WriteLine(x);'],
    ['a.md', 'See https://app.clikgate.com/staff/orgs'],
    ['a.md', 'Open the staff console.'],
    ['a.md', 'GET /v1/staff/leads'],
    ['a.md', 'http://localhost:8000/v1'],
    ['a.md', 'from clikgate_api/src/goals/services/goal_events.py'],
    ['a.md', '(backend contract C11 B2.1)'],
    ['a.md', 'added in change 09 X.E15'],
    ['a.md', 'http://api.clikgate.com'],
  ];
  const good = [
    ['a.ts', ' * console.log(link.short_url); // a doc example'],
    ['a.ts', "warn: (m) => console.warn(`[clikgate] ${m}`),"],
    ['a.md', 'console.log(result.status);'],
    ['a.py', '    """\n    print(clikgate.goals.send(...))\n    """'],
    ['a.md', 'Allowed: http://localhost and http://127.0.0.1 (any port) for local development.'],
    ['a.md', 'https://api.clikgate.com/v1/goals/events'],
    ['a.md', "runner: 'staff' (a value of the API)"],
    ['a.md', 'Exchange 09 rates'],
    ['a.md', 'cs_live_XXXX'],
  ];
  const fails = [];
  for (const [n, t] of bad) if (scanContent(n, Buffer.from(t)).length === 0) fails.push(`missed: ${n}: ${t}`);
  for (const [n, t] of good) {
    const f = scanContent(n, Buffer.from(t));
    if (f.length) fails.push(`false positive: ${n}: ${t} (${f.map((x) => x.rule).join(', ')})`);
  }
  const bin = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('https://staff.clikgate.com/x', 'utf16le'), Buffer.from([0, 0])]);
  if (!scanContent('a.dll', bin).some((x) => x.rule === 'internal-url')) fails.push('missed: a UTF-16 staff URL in a binary');
  if (fails.length) {
    console.error(fails.join('\n'));
    process.exit(1);
  }
  console.log(`scan-package self-test: ${bad.length + good.length + 1} checks passed`);
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  selfTest();
} else {
  if (args.length === 0) {
    console.error('usage: node server/scripts/scan-package.mjs <file or directory>...');
    process.exit(2);
  }
  let total = 0;
  for (const target of args) {
    const found = scanPath(target, basename(target));
    const perFile = new Map();
    for (const f of found) {
      const n = (perFile.get(f.file) ?? 0) + 1;
      perFile.set(f.file, n);
      if (n <= MAX_PER_FILE) console.error(`${f.file}${f.line ? `:${f.line}` : ''}: [${f.rule}] ${f.text.slice(0, 160)}`);
      else if (n === MAX_PER_FILE + 1) console.error(`${f.file}: … more findings in this file`);
    }
    total += found.length;
    console.log(`${basename(target)}: ${found.length === 0 ? 'clean' : `${found.length} finding(s) in ${perFile.size} file(s)`}`);
  }
  if (total > 0) {
    console.error(`Release scan failed: ${total} finding(s). Rules: ${RULES.map((r) => `${r.id} (${r.why})`).join('; ')}.`);
    process.exit(1);
  }
}
