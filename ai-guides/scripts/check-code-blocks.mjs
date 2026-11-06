#!/usr/bin/env node
// Compiles every code block tagged ```<lang> clikgate-check in the AI guides against the SDK sources (S.7 "Kept
// accurate"). Untagged blocks are fragments (manifest lines, one method) and aren't compiled.
//
//   node ai-guides/scripts/check-code-blocks.mjs --mobile <clikgate_mobile_sdk> [--require ts,swift,dart,kotlin]
//
// | lang   | how                                                                                             |
// |--------|-------------------------------------------------------------------------------------------------|
// | ts     | tsc --noEmit: blocks importing @clikgate/node against server/node/dist (build it first);         |
// |        | blocks importing @clikgate/react-native against react-native/src (npm ci in that folder first)    |
// | swift  | swiftc -parse (Linux and macOS). On macOS with --swift-typecheck: typechecked for the iOS        |
// |        | simulator against a Clikgate module built from ios/Sources/Clikgate                               |
// | dart   | flutter analyze in a scratch Flutter app with a path dependency on flutter/                     |
// | kotlin | kotlinc against $ANDROID_JAR and $CLIKGATE_ANDROID_CLASSES (classes of the built AAR)            |
//
// A language whose tool is missing is skipped with a warning, unless it is listed in --require (CI).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '..');
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const mobileOpt = opt('--mobile') ?? process.env.CLIKGATE_MOBILE_SDK;
// Absolute, because the generated tsconfigs live under ai-guides/.blocks/ and TypeScript resolves from there
const mobile = mobileOpt && path.resolve(mobileOpt);
const required = new Set((opt('--require') ?? '').split(',').filter(Boolean));
const swiftTypecheck = args.includes('--swift-typecheck');
if (!mobile) {
  console.error('usage: check-code-blocks.mjs --mobile <clikgate_mobile_sdk> [--require ts,swift,dart,kotlin] [--swift-typecheck]');
  process.exit(2);
}

const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const work = path.join(root, '.blocks');
fs.rmSync(work, { recursive: true, force: true });

// ---- extract
const blocks = [];
for (const file of walk(path.join(root, 'clikgate-setup')).filter((f) => f.endsWith('.md'))) {
  const src = fs.readFileSync(file, 'utf8').replace(/\{\{\s*versions\.([a-z_]+)\s*\}\}/g, (_, k) => versions[k]);
  let n = 0;
  for (const m of src.matchAll(/^( *)```(\w+) clikgate-check\n([\s\S]*?)^\1```$/gm)) {
    const code = m[3].split('\n').map((l) => l.slice(m[1].length)).join('\n');
    blocks.push({ file: path.relative(repo, file), lang: m[2], code, name: `${path.basename(file, '.md')}_${++n}` });
  }
}
const langs = [...new Set(blocks.map((b) => b.lang))];
console.log(`found ${blocks.length} checked blocks: ${langs.map((l) => `${l} ${blocks.filter((b) => b.lang === l).length}`).join(', ')}`);

const failures = [];
const skipped = [];
const run = (cmd, argv, cwd, label) => {
  const r = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    failures.push(`${label}:\n${(r.stdout ?? '') + (r.stderr ?? '') || r.error?.message}`);
    return false;
  }
  return true;
};
const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd]).status === 0;
const skip = (lang, why) => (required.has(lang) ? failures.push(`${lang}: required but ${why}`) : skipped.push(`${lang} (${why})`));
const write = (f, s) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, s);
};
const of = (lang) => blocks.filter((b) => b.lang === lang);

// ---- TypeScript
if (of('ts').length) {
  const tsc = path.join(repo, 'server', 'node', 'node_modules', 'typescript', 'bin', 'tsc');
  const nodeDist = path.join(repo, 'server', 'node', 'dist', 'esm', 'index.d.ts');
  const rn = path.join(mobile, 'react-native');
  if (!fs.existsSync(tsc)) skip('ts', 'server/node/node_modules is missing (npm ci in server/node)');
  else {
    const groups = {
      node: { blocks: of('ts').filter((b) => b.code.includes("'@clikgate/node")), ready: fs.existsSync(nodeDist), why: 'server/node/dist is missing (npm run build in server/node)' },
      rn: { blocks: of('ts').filter((b) => b.code.includes("'@clikgate/react-native'")), ready: fs.existsSync(path.join(rn, 'node_modules', 'react-native')), why: 'react-native/node_modules is missing (npm ci in clikgate_mobile_sdk/react-native)' },
    };
    const other = of('ts').filter((b) => !groups.node.blocks.includes(b) && !groups.rn.blocks.includes(b));
    for (const b of other) failures.push(`${b.file} (${b.name}): a ts clikgate-check block must import @clikgate/node or @clikgate/react-native`);
    for (const [g, { blocks: list, ready, why }] of Object.entries(groups)) {
      if (!list.length) continue;
      if (!ready) { skip('ts', why); continue; }
      const dir = path.join(work, `ts-${g}`);
      for (const b of list) write(path.join(dir, `${b.name}.${g === 'rn' ? 'tsx' : 'ts'}`), b.code);
      const paths =
        g === 'node'
          ? { '@clikgate/node': [nodeDist], '@clikgate/node/*': [path.join(repo, 'server/node/dist/esm/*.d.ts')] }
          : { '@clikgate/react-native': [path.join(rn, 'src/index.ts')], 'react': [path.join(rn, 'node_modules/@types/react')], 'react-native': [path.join(rn, 'node_modules/react-native')] };
      write(
        path.join(dir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            strict: true, noEmit: true, skipLibCheck: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
            jsx: 'react-jsx', paths,
            typeRoots: [path.join(g === 'node' ? path.join(repo, 'server/node') : rn, 'node_modules/@types')],
            types: g === 'node' ? ['node'] : [],
          },
          include: ['*.ts', '*.tsx'],
        }, null, 2),
      );
      run(process.execPath, [tsc, '-p', dir], dir, `ts (${g}): ${list.map((b) => b.file).join(', ')}`);
    }
  }
}

// ---- Swift
if (of('swift').length) {
  if (!has('swiftc')) skip('swift', 'swiftc not found');
  else {
    const dir = path.join(work, 'swift');
    for (const b of of('swift')) {
      const f = path.join(dir, `${b.name}.swift`);
      write(f, b.code);
      run('swiftc', ['-parse', '-parse-as-library', f], dir, `swift parse ${b.file} (${b.name})`);
    }
    if (swiftTypecheck && process.platform === 'darwin') {
      const sources = walk(path.join(mobile, 'ios', 'Sources', 'Clikgate')).filter((f) => f.endsWith('.swift'));
      const target = `${os.arch() === 'arm64' ? 'arm64' : 'x86_64'}-apple-ios15.0-simulator`;
      const sdk = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { encoding: 'utf8' }).stdout.trim();
      const mod = path.join(dir, 'module');
      fs.mkdirSync(mod, { recursive: true });
      if (run('xcrun', ['swiftc', '-emit-module', '-module-name', 'Clikgate', '-parse-as-library', '-target', target, '-sdk', sdk, '-emit-module-path', path.join(mod, 'Clikgate.swiftmodule'), ...sources], dir, 'swift: build the Clikgate module')) {
        for (const b of of('swift')) {
          run('xcrun', ['swiftc', '-typecheck', '-parse-as-library', '-target', target, '-sdk', sdk, '-I', mod, path.join(dir, `${b.name}.swift`)], dir, `swift typecheck ${b.file} (${b.name})`);
        }
      }
    }
  }
}

// ---- Dart
if (of('dart').length) {
  if (!has('flutter')) skip('dart', 'flutter not found');
  else {
    const dir = path.join(work, 'dart');
    write(path.join(dir, 'pubspec.yaml'), `name: guide_blocks\npublish_to: none\nenvironment:\n  sdk: ">=3.5.0 <4.0.0"\n  flutter: ">=3.24.0"\ndependencies:\n  flutter:\n    sdk: flutter\n  clikgate_flutter:\n    path: ${path.join(mobile, 'flutter')}\n`);
    for (const b of of('dart')) write(path.join(dir, 'lib', `${b.name}.dart`), b.code);
    if (run('flutter', ['pub', 'get'], dir, 'dart: flutter pub get')) run('flutter', ['analyze', '--no-fatal-infos', 'lib'], dir, `dart: ${of('dart').map((b) => b.file).join(', ')}`);
  }
}

// ---- Kotlin
if (of('kotlin').length) {
  const jar = process.env.ANDROID_JAR;
  const classes = process.env.CLIKGATE_ANDROID_CLASSES;
  if (!has('kotlinc')) skip('kotlin', 'kotlinc not found');
  else if (!jar || !classes) skip('kotlin', 'ANDROID_JAR / CLIKGATE_ANDROID_CLASSES not set');
  else {
    const dir = path.join(work, 'kotlin');
    const files = of('kotlin').map((b) => {
      const f = path.join(dir, `${b.name}.kt`);
      write(f, b.code);
      return f;
    });
    run('kotlinc', ['-cp', [jar, ...classes.split(path.delimiter)].join(path.delimiter), '-d', path.join(dir, 'out'), ...files], dir, `kotlin: ${of('kotlin').map((b) => b.file).join(', ')}`);
  }
}

for (const lang of langs.filter((l) => !['ts', 'swift', 'dart', 'kotlin'].includes(l))) skip(lang, 'no checker for this language yet');

if (skipped.length) console.warn(`skipped: ${skipped.join('; ')}`);
if (failures.length) {
  console.error(`code-block check failed:\n\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('code-block check passed');
