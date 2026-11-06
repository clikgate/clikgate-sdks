#!/usr/bin/env node
// package.json, src/version.ts and (on a tag) the tag server-node-v<version> must agree.
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const src = /VERSION = '([^']+)'/.exec(readFileSync(new URL('../src/version.ts', import.meta.url), 'utf8'))?.[1];
const tag = process.env.GITHUB_REF_NAME?.startsWith('server-node-v') ? process.env.GITHUB_REF_NAME.slice('server-node-v'.length) : null;
const problems = [];
if (src !== pkg.version) problems.push(`src/version.ts says ${src}, package.json says ${pkg.version}`);
if (tag && tag !== pkg.version) problems.push(`tag says ${tag}, package.json says ${pkg.version}`);
if (Object.keys(pkg.dependencies ?? {}).length) problems.push('@clikgate/node must have zero runtime dependencies');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`version ${pkg.version} ok`);
