#!/usr/bin/env node
// Generates ai-guides/clikgate-setup/references/api-surface.md: the public API of every Clikgate SDK, so an
// AI assistant never invents methods. Run it from anywhere:
//
//   node ai-guides/scripts/generate-api-surface.mjs --mobile <clikgate_mobile_sdk> [--web <clikgate.js>] [--check]
//
// Sources (public declarations only, comments stripped):
//   Flutter  flutter/lib/src/{clikgate,referrals,models}.dart      React Native  react-native/src/*.ts
//   Android  android/clikgate/src/main/java/com/clikgate/*.kt      iOS           ios/Sources/Clikgate/Public/*.swift
//   Node     server/node/dist/esm/*.d.ts (tsc's declaration output; run `npm run build` in server/node first)
//   Web      clikgate_api/src/static/clikgate.js (optional: without --web the existing Web section is kept)
// --check exits 1 when the file on disk differs (CI drift check).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const OUT = path.join(repo, 'ai-guides', 'clikgate-setup', 'references', 'api-surface.md');

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const mobile = opt('--mobile') ?? process.env.CLIKGATE_MOBILE_SDK;
const web = opt('--web') ?? process.env.CLIKGATE_WEB_SCRIPT;
const check = args.includes('--check');
if (!mobile) {
  console.error('usage: generate-api-surface.mjs --mobile <path to clikgate_mobile_sdk> [--web <clikgate.js>] [--check]');
  process.exit(2);
}
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');

// ---------- text helpers

/** Removes // and /* *\/ comments, keeping strings intact. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    out += c;
    i++;
  }
  return out;
}

/** Index just after the bracket that closes the one at `open`. */
function closeOf(src, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  throw new Error(`unbalanced bracket at ${open}`);
}

/** The body (between braces) of the first declaration matching `re`. */
function bodyOf(src, re) {
  const m = re.exec(src);
  if (!m) throw new Error(`declaration not found: ${re}`);
  const open = src.indexOf('{', m.index + m[0].length - 1);
  return src.slice(open + 1, closeOf(src, open) - 1);
}

/**
 * A declaration starting at `start`, up to (not including) the body: stops at a depth-0 `{`, `=>`, `=` or `;`.
 * Brackets inside parameter lists are skipped as a whole.
 */
function signatureAt(src, start, { equals = true } = {}) {
  let i = start;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; i++; continue; }
    if (c === '(' || c === '[') { i = closeOf(src, i); continue; }
    if (c === '{' || c === ';' || c === '\n' && /^\s*\n/.test(src.slice(i))) break;
    if (equals && c === '=' && src[i + 1] !== '=' && src[i - 1] !== '!' && src[i - 1] !== '<' && src[i - 1] !== '>') break;
    i++;
  }
  return tidy(src.slice(start, i));
}

const tidy = (s) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/,\s*\)/g, ')')
    .replace(/\{\s+/g, '{')
    .replace(/,\s*\}/g, '}')
    .replace(/\s+\}/g, '}')
    .replace(/\s+(async|=>)\s*$/, '')
    .replace(/\s+async$/, '')
    .trim();

/** Member declarations of a class/object body at exactly `indent` spaces whose first line matches `re`. */
function members(body, indent, re, { skipIf, equals = true } = {}) {
  const out = [];
  const lines = body.split('\n');
  let offset = 0;
  const prefix = ' '.repeat(indent);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const isMember = line.startsWith(prefix) && line[indent] !== ' ' && re.test(line.slice(indent));
    if (isMember && !(skipIf && skipIf(line.slice(indent), lines.slice(Math.max(0, li - 3), li).map((l) => l.trim())))) {
      out.push(signatureAt(body, offset + indent, { equals }));
    }
    offset += line.length + 1;
  }
  return out;
}

/** Splits a declaration body at top-level `;` (not inside braces, brackets or parentheses). */
function splitTop(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of body) {
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    if (c === ';' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Options that exist only for the conformance runner (SPEC.md section 18). */
const TEST_SEAMS = /^(clock|random)\?:/;

const block = (lang, lines) => '```' + lang + '\n' + lines.join('\n') + '\n```\n';

// ---------- Flutter

function flutter() {
  const base = path.join(mobile, 'flutter');
  const version = /^version:\s*(\S+)/m.exec(read(base, 'pubspec.yaml'))[1];
  const main = stripComments(read(base, 'lib/src/clikgate.dart'));
  const cls = bodyOf(main, /class Clikgate\b[^{]*\{/);
  const statics = members(cls, 2, /^static /, {
    skipIf: (l) => /^static\s+(?:const\s+|final\s+)?[\w<>?, ]+\s+_|resetForTesting|^static\s+\w[\w<>?]*\s+_/.test(l) || /\b_\w+\s*[(=;]/.test(l.split('(')[0]),
  }).map((s) => s.replace(/^static /, 'static '));
  const referrals = stripComments(read(base, 'lib/src/referrals.dart'));
  const refBody = bodyOf(referrals, /class ClikgateReferrals\b[^{]*\{/);
  const refs = members(refBody, 2, /^(?!const |final |static |_|@)[\w<>?]+[\w<>?, ]*\s+\w+\(/);
  const models = stripComments(read(base, 'lib/src/models.dart'));
  const fields = (name) => members(bodyOf(models, new RegExp(`class ${name}\\b[^{]*\\{`)), 2, /^final /).map((f) => '  ' + f + ';');
  return [
    `### Flutter: \`clikgate_flutter\` ${version}`,
    '',
    "`import 'package:clikgate_flutter/clikgate_flutter.dart';` Every method is static on `Clikgate`.",
    '',
    block('dart', [
      'class Clikgate {',
      ...statics.map((s) => '  ' + s + ';'),
      '}',
      '',
      'class ClikgateReferrals { // Clikgate.referrals',
      ...refs.map((s) => '  ' + s + ';'),
      '}',
      '',
      'class ClikgateDeepLink {',
      ...fields('ClikgateDeepLink'),
      '}',
    ]),
  ].join('\n');
}

// Change 22: `ClikgateMoney` (the track() revenue helper) was removed from every mobile SDK with track().
function mustMatch(src, re, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`${what} not found in the SDK source (has it moved? update generate-api-surface.mjs)`);
  return m[0].replace(/\s+/g, ' ').trim();
}

// ---------- React Native

function reactNative() {
  const base = path.join(mobile, 'react-native');
  const version = JSON.parse(read(base, 'package.json')).version;
  const src = stripComments(read(base, 'src/Clikgate.ts'));
  const obj = bodyOf(src, /export const Clikgate\b[^=]*=\s*\{/);
  const methods = members(obj, 2, /^(async\s+)?\w+\s*[(<]/, { skipIf: (l) => /^(async\s+)?_/.test(l), equals: false }).map((s) => s.replace(/^async\s+/, ''));
  const refSrc = stripComments(read(base, 'src/referrals.ts'));
  let refs = [];
  try {
    refs = members(bodyOf(refSrc, /export const referrals\b[^=]*=\s*\{/), 2, /^(async\s+)?\w+\s*[(<]/, { equals: false }).map((s) => s.replace(/^async\s+/, ''));
  } catch {
    refs = [];
  }
  const models = stripComments(read(base, 'src/models.ts'));
  const iface = (name) => {
    const body = bodyOf(models, new RegExp(`export interface ${name}\\b[^{]*\\{`));
    return [`interface ${name} {`, ...body.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => '  ' + l.replace(/\s+/g, ' ')), '}'];
  };
  const alias = (name) => tidy(new RegExp(`export type ${name}\\b[^;]*;`).exec(models)[0].replace(/^export /, ''));
  return [
    `### React Native and Expo: \`@clikgate/react-native\` ${version}`,
    '',
    "`import { Clikgate } from '@clikgate/react-native';`",
    '',
    block('ts', [
      'const Clikgate: {',
      ...methods.map((s) => '  ' + s + ';'),
      '};',
      '',
      'const referrals: { // import { referrals } from \'@clikgate/react-native\'',
      ...refs.map((s) => '  ' + s + ';'),
      '};',
      '',
      ...iface('ClikgateConfig'),
      ...iface('GoalOptions'),
      ...iface('ClikgateDeepLink'),
      ...iface('ClikgateConsentUpdate'),
      alias('ConsentState'),
      alias('ClikgateLogLevel'),
    ]),
    '',
    'Expo config plugin props (`app.json` › `plugins` › `["@clikgate/react-native", {…}]`): `linkDomains` (live domains: the app link subdomain and custom domains, never a shared domain), `testLinkDomain` (the app test subdomain, e.g. `"yourapp.dev.ciz.to"`), `testVariants` (default `["development", "preview"]`), `uriScheme`, `enableBackgroundRemoteNotifications`, `enableWhatsAppSharing`.',
    '',
  ].join('\n');
}

// ---------- Android

function android() {
  const base = path.join(mobile, 'android');
  const props = read(base, 'gradle.properties');
  const group = /^GROUP=(.+)$/m.exec(props)?.[1]?.trim() ?? 'com.clikgate';
  const version = /^VERSION_NAME=(.+)$/m.exec(props)[1].trim();
  const pkg = path.join(base, 'clikgate/src/main/java/com/clikgate');
  const internal = (l, before) => before.some((b) => b.startsWith('@ClikgateInternalApi'));
  const src = stripComments(read(pkg, 'Clikgate.kt'));
  // Annotations stay in the stripped text, so @ClikgateInternalApi is still visible to skipIf.
  const obj = bodyOf(src, /public object Clikgate\b[^{]*\{/);
  const api = members(obj, 4, /^public (fun|val|var|suspend fun) /, { skipIf: internal }).map((s) => s.replace(/^public /, '').replace(/\s+get\(\)$/, ''));
  const refSrc = stripComments(read(pkg, 'ClikgateReferrals.kt'));
  let refs = [];
  try {
    refs = members(bodyOf(refSrc, /public object ClikgateReferrals\b[^{]*\{/), 4, /^public (fun|suspend fun) /, { skipIf: internal }).map((s) => s.replace(/^public /, ''));
  } catch {
    refs = [];
  }
  const dataClass = (file, name) => {
    const s = stripComments(read(pkg, file));
    const m = new RegExp(`public data class ${name}\\b[^(]*\\(`).exec(s);
    const open = s.indexOf('(', m.index + m[0].length - 1);
    return tidy(s.slice(m.index, closeOf(s, open))).replace(/^public /, '').replace(/ @JvmOverloads constructor/, '');
  };
  const enumClass = (file, name) => {
    const src2 = stripComments(read(pkg, file));
    const body = bodyOf(src2, new RegExp(`public enum class ${name}\\b[^{]*\\{`));
    const names = [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\(/gm)].map((x) => x[1]);
    if (names.length === 0) throw new Error(`Android enum ${name}: no constants found`);
    return `enum class ${name}(val value: String) { ${names.join(', ')} }`;
  };
  return [
    `### Android: \`${group}:clikgate-android:${version}\``,
    '',
    '`import com.clikgate.Clikgate` (and `com.clikgate.ClikgateOptions`, `com.clikgate.Provider`, `com.clikgate.GoalStatus`). Every method is on the `Clikgate` object.',
    '',
    block('kotlin', [
      'object Clikgate {',
      ...api.map((s) => '    ' + s),
      '}',
      '',
      'object ClikgateReferrals { // Clikgate.referrals',
      ...refs.map((s) => '    ' + s),
      '}',
      '',
      dataClass('ClikgateOptions.kt', 'ClikgateOptions'),
      dataClass('Models.kt', 'GoalResult'),
      enumClass('Models.kt', 'GoalStatus'),
      enumClass('Models.kt', 'GoalKind'),
      'class Provider { companion object { val PAYSTACK: Provider; val FLUTTERWAVE: Provider; …; fun fromString(value: String): Provider? } } // every gateway, generated',
      dataClass('Models.kt', 'ClikgateDeepLink'),
    ]),
  ].join('\n');
}

// ---------- iOS

function ios() {
  const base = path.join(mobile, 'ios');
  const pub = path.join(base, 'Sources/Clikgate/Public');
  const main = stripComments(read(pub, 'Clikgate.swift'));
  const version = /sdkVersion\s*=\s*"([^"]+)"/.exec(main)[1];
  const cls = bodyOf(main, /public final class Clikgate\b[^{]*\{/);
  const skip = (l, before) => /^(@objc\s+)?public (static )?func (objc_|setWrapper|setConsentRegionValidated)/.test(l) || before.some((b) => b.startsWith('@_spi'));
  const api = members(cls, 4, /^(@objc\s+)?public (static |final )?(func|var|let) /, { skipIf: skip })
    .map((s) => s.replace(/^@objc\s+/, '').replace(/^public /, '').replace(/\s*\{\s*currentCore.*$/, ''));
  const structFields = (file, name) => {
    const s = stripComments(read(pub, file));
    const body = bodyOf(s, new RegExp(`public struct ${name}\\b[^{]*\\{`));
    return members(body, 4, /^public (let|var) /).map((f) => '    ' + f.replace(/^public /, ''));
  };
  const optionsSrc = stripComments(read(pub, 'ClikgateOptions.swift'));
  const optBody = bodyOf(optionsSrc, /public struct ClikgateOptions\b[^{]*\{/);
  const init = members(optBody, 4, /^public init\(/).map((s) => s.replace(/^public /, ''));
  return [
    `### iOS: pod \`Clikgate\` / Swift package \`clikgate-ios-sdk\` ${version}`,
    '',
    '`import Clikgate`. `configure` is static; everything else is on `Clikgate.shared`.',
    '',
    block('swift', [
      'final class Clikgate {',
      ...api.map((s) => '    ' + s),
      '}',
      '',
      'struct ClikgateOptions {',
      ...init.map((s) => '    ' + s),
      '}',
      '',
      'struct ClikgateDeepLinkResult {',
      ...structFields('ClikgateModels.swift', 'ClikgateDeepLinkResult'),
      '}',
    ]),
  ].join('\n');
}

// ---------- Node

function node() {
  const dist = path.join(repo, 'server', 'node', 'dist', 'esm');
  const version = JSON.parse(read(repo, 'server', 'node', 'package.json')).version;
  if (!fs.existsSync(path.join(dist, 'client.d.ts'))) throw new Error('server/node/dist/esm is missing: run `npm ci && npm run build` in server/node');
  const dts = (f) => stripComments(read(dist, f));
  const classMembers = (file, name, kw = 'class') => {
    const body = bodyOf(dts(file), new RegExp(`export declare ${kw} ${name}\\b[^{]*\\{|export ${kw} ${name}\\b[^{]*\\{`));
    return splitTop(body)
      .map((m) => tidy(m))
      .filter((m) => m && !/^(private|#|protected)\b/.test(m) && !m.startsWith('_') && !TEST_SEAMS.test(m));
  };
  const section = (title, file, name, kw, note) => [`${title} {${note ? ' // ' + note : ''}`, ...classMembers(file, name, kw).map((m) => '  ' + m + ';'), '}', ''];
  const exports = (file) =>
    [...dts(file).matchAll(/export (?:declare )?(?:const|function) (\w+)/g)].map((m) => m[1]);
  return [
    `### Node.js: \`@clikgate/node\` ${version}`,
    '',
    "`import { Clikgate, webhooks } from '@clikgate/node';` Add-ons: `@clikgate/node/express` (" +
      exports('express.d.ts').map((e) => '`' + e + '`').join(', ') +
      '), `@clikgate/node/fastify` (' +
      exports('fastify.d.ts').map((e) => '`' + e + '`').join(', ') +
      '), `@clikgate/node/next` (' +
      exports('next.d.ts').map((e) => '`' + e + '`').join(', ') +
      ').',
    '',
    block('ts', [
      ...section('class Clikgate', 'client.d.ts', 'Clikgate'),
      ...section('interface ClikgateOptions', 'client.d.ts', 'ClikgateOptions', 'interface'),
      ...section('class Goals', 'goals.d.ts', 'Goals', 'class', 'clikgate.goals'),
      ...section('interface GoalOptions', 'goals.d.ts', 'GoalOptions', 'interface'),
      ...section('class ClickIds', 'click-ids.d.ts', 'ClickIds', 'class', 'clikgate.clickIds'),
      ...section('class Links', 'resources.d.ts', 'Links', 'class', 'clikgate.links'),
      ...section('class Conversions', 'resources.d.ts', 'Conversions', 'class', 'clikgate.conversions'),
      ...section('class Payments', 'payments.d.ts', 'Payments', 'class', 'clikgate.payments'),
      ...section('interface PaymentConfirmParams', 'payments.d.ts', 'PaymentConfirmParams', 'interface'),
    ]).trimEnd(),
    '',
    'Webhooks: `webhooks.verify(rawBody, signatureHeader, secret, { tolerance? })` and `webhooks.verifyAny(rawBody, signatureHeader, secrets[], { tolerance? })`. No client or API key is needed.',
    '',
    nodeEnums(),
    '',
  ].join('\n');
}

// Node enums (generated from openapi.json into server/node/src/enums.ts): constants and their members.
function nodeEnums() {
  const src = read(repo, 'server', 'node', 'src', 'enums.ts');
  const list = [...src.matchAll(/export const (\w+) = \{([^}]*)\}/g)].map((m) => {
    const keys = [...m[2].matchAll(/^\s*(\w+):/gm)].map((k) => k[1]);
    if (keys.length === 0) throw new Error(`Node enum ${m[1]}: no members`);
    const shown = keys.length > 6 ? [...keys.slice(0, 3), '…', keys[keys.length - 1]] : keys;
    return `\`${m[1]}\` (${shown.map((k) => (k === '…' ? k : `\`${m[1]}.${k}\``)).join(', ')})`;
  });
  if (list.length === 0) throw new Error('server/node/src/enums.ts has no enums');
  return `Enums (constants and types, \`import { GoalKind, GoalStatus, Provider } from '@clikgate/node';\`): ${list.join('; ')}. \`Provider\` lists every gateway; a provider key string works too.`;
}

// ---------- Web

function webScript(existing) {
  if (!web) {
    const m = /(### Web script[\s\S]*?)(?=\n### |\n## |$)/.exec(existing ?? '');
    if (!m) throw new Error('no --web given and no existing Web section to keep');
    console.warn('generate-api-surface: --web not given; keeping the existing Web script section');
    return m[1].trimEnd() + '\n';
  }
  const src = fs.readFileSync(web, 'utf8');
  const fns = [...src.matchAll(/api\.(\w+)\s*=\s*function\s*\(([^)]*)\)/g)].map((m) => `Clikgate.${m[1]}(${m[2].trim()})`);
  // namespaced methods: `api.share = { mount: function (element, o) ...`
  for (const m of src.matchAll(/api\.(\w+)\s*=\s*\{\s*(\w+):\s*function\s*\(([^)]*)\)/g)) fns.push(`Clikgate.${m[1]}.${m[2]}(${m[3].trim()})`);
  const attrs = [...src.matchAll(/attr\("(data-[\w-]+)",\s*(?:"([^"]*)"|'([^']*)'|[^)]*)\)/g)].map((m) => {
    const def = m[2] ?? m[3];
    return def ? `\`${m[1]}\` (default \`${def}\`)` : `\`${m[1]}\``;
  });
  // constant objects on the api (GoalStatus, Provider): `Name: CONST_NAME,` inside `var api = {`
  const apiObj = /var api = \{([\s\S]*?)\n  \};/.exec(src)?.[1] ?? '';
  const consts = [...apiObj.matchAll(/^\s*([A-Z]\w*): ([A-Z_]+),/gm)].map((m) => {
    const body = new RegExp(`var ${m[2]} = \\{([^}]*)\\}`).exec(src)?.[1] ?? '';
    const keys = [...body.matchAll(/(\w+):/g)].map((k) => k[1]);
    const shown = keys.length > 6 ? [...keys.slice(0, 3), '…', keys[keys.length - 1]] : keys;
    return `\`Clikgate.${m[1]}\` (${shown.map((k) => (k === '…' ? k : `\`${k}\``)).join(', ')})`;
  });
  return [
    '### Web script: `https://sdk.clikgate.com/v1/static/clikgate.js`',
    '',
    'Script tag attributes: ' + [...new Set(attrs)].join(', ') + '.',
    '',
    block('js', [...new Set(fns)].sort()),
    ...(consts.length ? ['', `Constants: ${consts.join('; ')}. \`Clikgate.goal(key, {reference, provider, value, currency, isFirst})\` returns a promise of \`{status, reason}\`.`] : []),
  ].join('\n');
}

// ---------- assemble

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : undefined;
const doc = [
  '# Clikgate public SDK API',
  '',
  '<!-- Generated by ai-guides/scripts/generate-api-surface.mjs from the SDK sources. Do not edit by hand. -->',
  '',
  'These are **all** the public methods. If something isn\'t listed here, it doesn\'t exist: don\'t call it.',
  'Signatures are shown in each language\'s own syntax, with comments and bodies removed.',
  '',
  '## Mobile',
  '',
  flutter(),
  reactNative(),
  android(),
  ios(),
  '## Web',
  '',
  webScript(existing),
  '## Server',
  '',
  node(),
  'Python (`clikgate`), PHP (`clikgate/clikgate-php`), Java (`com.clikgate:clikgate-java`) and .NET (`Clikgate`) are **not available yet**. Use the HTTP API in [server-sdks.md](server-sdks.md).',
  '',
].join('\n').replace(/\n{3,}/g, '\n\n');

if (check) {
  if (existing !== doc) {
    const tmp = OUT + '.new';
    fs.writeFileSync(tmp, doc);
    console.error(`api-surface.md is out of date. Regenerate it with generate-api-surface.mjs (new version written to ${path.relative(repo, tmp)}).`);
    process.exit(1);
  }
  console.log('api-surface.md is up to date');
} else {
  fs.writeFileSync(OUT, doc);
  console.log(`wrote ${path.relative(repo, OUT)}`);
}
