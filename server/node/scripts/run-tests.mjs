#!/usr/bin/env node
// Compile src + test with tsc into .test-dist, then run the unit tests (node:test) and/or the
// conformance suite. Works on Node 18+ (no TS loader needed).
//   node scripts/run-tests.mjs [--unit] [--conformance] [--no-compile]
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const unit = args.includes('--unit') || !args.includes('--conformance');
const conformance = args.includes('--conformance') || !args.includes('--unit');
const out = join(root, '.test-dist');

const run = (cmd, a) => {
  const r = spawnSync(cmd, a, { stdio: 'inherit', cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

if (!args.includes('--no-compile')) {
  rmSync(out, { recursive: true, force: true });
  run(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.json')]);
}
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
if (unit) {
  const files = walk(join(out, 'test')).filter((f) => f.endsWith('.test.js')).sort();
  run(process.execPath, ['--test', ...files]);
}
if (conformance) run(process.execPath, [join(out, 'test', 'conformance', 'runner.js'), ...args.filter((a) => a.startsWith('--filter') || a === '--verbose' || !a.startsWith('--'))]);
