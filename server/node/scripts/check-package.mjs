#!/usr/bin/env node
// After `npm run build`: every export resolves from ESM and CJS, has types, and the tarball holds only dist + docs.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const require = createRequire(import.meta.url);
const major = Number(process.versions.node.split('.')[0]);
const problems = [];
for (const [sub, conditions] of Object.entries(pkg.exports)) {
  if (typeof conditions === 'string') continue;
  for (const [cond, target] of Object.entries(conditions)) {
    for (const file of [target.types, target.default]) if (!existsSync(join(root, file))) problems.push(`${sub} ${cond}: missing ${file}`);
  }
  const name = sub === '.' ? pkg.name : `${pkg.name}${sub.slice(1)}`;
  // the Fastify and Next add-ons import their frameworks, which need Node 20+
  if ((sub === './next' || sub === './fastify') && major < 20) continue;
  try {
    require(name);
  } catch (e) {
    problems.push(`require(${name}): ${e.message}`);
  }
  try {
    await import(name);
  } catch (e) {
    problems.push(`import(${name}): ${e.message}`);
  }
}
const { Clikgate } = require(pkg.name);
const esm = await import(pkg.name);
if (typeof Clikgate !== 'function' || typeof esm.Clikgate !== 'function') problems.push('Clikgate is not exported');
const listing = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }))[0];
const stray = listing.files.map((f) => f.path).filter((p) => !/^(dist\/|README\.md$|CHANGELOG\.md$|SECURITY\.md$|LICENSE$|package\.json$)/.test(p));
if (stray.length) problems.push(`unexpected files in the tarball: ${stray.join(', ')}`);
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`package ok: ${listing.files.length} files, ${(listing.size / 1024).toFixed(0)} kB packed`);
