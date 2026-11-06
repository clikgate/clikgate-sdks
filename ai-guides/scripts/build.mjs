#!/usr/bin/env node
// Resolves {{versions.*}} and writes the publishable outputs to ai-guides/dist/ (git-ignored):
//
//   dist/clikgate-skills/                    the public repository clikgate/clikgate-skills
//     skills/clikgate-setup/…                (found by `npx skills add clikgate/clikgate-skills`)
//     README.md, AGENTS.md, LICENSE
//   dist/website/                            files for clikgate.com (W.2)
//     docs/ai/setup.md                       the whole skill as one page (SKILL.md + every reference)
//     docs/ai/setup/<reference>.md           each reference on its own
//     .well-known/agent-skills/index.json    skills-installer discovery (`npx skills add https://clikgate.com`)
//     .well-known/agent-skills/clikgate-setup/…
//     llms.txt, llms-full.txt                llmstxt.org files covering setup and the SDKs
//
// Usage: node ai-guides/scripts/build.mjs [--out <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repo = path.resolve(root, '..');
const args = process.argv.slice(2);
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'dist'));
const SITE = 'https://clikgate.com';
const skillName = 'clikgate-setup';
const skillDir = path.join(root, skillName);

const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json'), 'utf8'));
const resolve = (s, file) =>
  s.replace(/\{\{\s*versions\.([a-z_]+)\s*\}\}/g, (_, k) => {
    if (!(k in versions)) throw new Error(`${file}: {{versions.${k}}} isn't in versions.json`);
    return versions[k];
  });

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(skillDir).map((f) => path.relative(skillDir, f)).sort();
const resolved = Object.fromEntries(files.map((f) => [f, resolve(fs.readFileSync(path.join(skillDir, f), 'utf8'), f)]));

const write = (file, content) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
fs.rmSync(out, { recursive: true, force: true });

// ---- 1. Public skills repository
const pub = path.join(out, 'clikgate-skills');
for (const f of files) write(path.join(pub, 'skills', skillName, f), resolved[f]);
write(path.join(pub, 'README.md'), resolve(fs.readFileSync(path.join(root, 'public', 'README.md'), 'utf8'), 'public/README.md'));
write(path.join(pub, 'AGENTS.md'), resolve(fs.readFileSync(path.join(root, 'plain', 'AGENTS.md'), 'utf8'), 'plain/AGENTS.md'));
fs.copyFileSync(path.join(repo, 'LICENSE'), path.join(pub, 'LICENSE'));

// ---- 2. Website files
const web = path.join(out, 'website');
const frontmatter = /^---\n([\s\S]*?)\n---\n/;
const skillMd = resolved['SKILL.md'];
const description = /^description:\s*(.+)$/m.exec(frontmatter.exec(skillMd)[1])[1].trim();
const body = skillMd.replace(frontmatter, '');
const refs = files.filter((f) => f.startsWith('references/') && f.endsWith('.md'));
const pageUrl = (ref) => `${SITE}/docs/ai/setup/${path.basename(ref)}`;
const absolutise = (s, from) =>
  s.replace(/\]\(((?:references\/)?[a-z-]+\.md)(#[^)]*)?\)/g, (m, target, hash = '') => {
    const ref = target.startsWith('references/') ? target : path.posix.join(path.posix.dirname(from), target);
    return refs.includes(ref) ? `](${pageUrl(ref)}${hash})` : m;
  });

const onePage = [
  absolutise(body, 'SKILL.md').trimEnd(),
  '',
  ...refs.flatMap((r) => ['', '---', '', `<!-- ${r} -->`, '', absolutise(resolved[r], r).trimEnd(), '']),
].join('\n');
write(path.join(web, 'docs', 'ai', 'setup.md'), onePage + '\n');
for (const r of refs) write(path.join(web, 'docs', 'ai', 'setup', path.basename(r)), absolutise(resolved[r], r));

// Skills-installer discovery (the legacy files[] index: plain files, no archive needed)
const wk = path.join(web, '.well-known', 'agent-skills');
write(path.join(wk, 'index.json'), JSON.stringify({ skills: [{ name: skillName, description, files }] }, null, 2) + '\n');
for (const f of files) write(path.join(wk, skillName, f), resolved[f]);

// llms.txt (llmstxt.org): H1, blockquote summary, then sections of links to .md pages
const llms = `# Clikgate

> Clikgate sees every click: it tracks each click on a link through to the app install, the app open and the business's end goal, with deep links, app links and goal tracking for Flutter, React Native, Expo, Android, iOS, websites and servers. Set it up in one command with \`npx @clikgate/setup\`, or ask an AI coding assistant to use the Clikgate setup guide.

Use only test keys (\`cg_sdk_test_…\`) when setting up. Apps open links from their own link subdomain (\`yourapp.ciz.to\`) and custom domains, never from a shared domain; the test subdomain \`yourapp.dev.ciz.to\` belongs in debug builds only.

## Setup

- [AI setup guide](${SITE}/docs/ai/setup.md): the complete guide for AI coding assistants (the clikgate-setup skill)
- [Setup command](${SITE}/docs/setup-command.md): every flag of \`npx @clikgate/setup\` and \`doctor\`
- [Set up with AI](${SITE}/docs/ai.md): installing the skill in Claude Code, Cursor and Codex

## SDKs

${refs
  .filter((r) => /flutter|react-native|expo|android|ios|web|server-sdks/.test(r))
  .map((r) => `- [${title(resolved[r])}](${pageUrl(r)})`)
  .join('\n')}
- [Public API surface](${pageUrl('references/api-surface.md')}): every public SDK method

## API

- [API reference](${SITE}/docs/api-reference.md)

## Concepts

- [Goals](${pageUrl('references/goals.md')}): the end goal, values, reversals and private mode
- [Payment goals](${pageUrl('references/payments.md')}): report payments from the website or app (never an amount), confirm them from a trusted source; server helpers after your own verification
- [Test links](${pageUrl('references/test-links.md')}): the app's test subdomain, test pages and allowed destinations
- [Open in app links](${SITE}/docs/open-in-app.md): links to Instagram, TikTok, Jumia and other apps that open the app on phones

## Optional

- [Troubleshooting](${pageUrl('references/troubleshooting.md')}): doctor check IDs and fixes
`;
write(path.join(web, 'llms.txt'), llms);
write(path.join(web, 'llms-full.txt'), `# Clikgate\n\n> Clikgate sees every click. This file holds the full text of the setup guide and the SDK pages.\n\n${onePage}\n`);

console.log(`built ${path.relative(process.cwd(), out) || out}: ${files.length} skill files, ${refs.length} reference pages`);

function title(md) {
  return /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? 'Untitled';
}
