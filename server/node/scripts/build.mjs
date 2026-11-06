#!/usr/bin/env node
// Build ESM (dist/esm) and CJS (dist/cjs), each with its own .d.ts and a package.json marking the format,
// so `import` and `require` consumers both get matching types (no "masquerading" declarations).
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
rmSync(join(root, 'dist'), { recursive: true, force: true });
for (const project of ['tsconfig.build.json', 'tsconfig.cjs.json']) {
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, project)], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
writeFileSync(join(root, 'dist', 'esm', 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
writeFileSync(join(root, 'dist', 'cjs', 'package.json'), `${JSON.stringify({ type: 'commonjs' })}\n`);
console.log('Built dist/esm and dist/cjs');
