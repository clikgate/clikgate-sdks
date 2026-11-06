# Clikgate skills

The Clikgate setup guide for AI coding assistants, in the [Agent Skills](https://agentskills.io) format. With it, an assistant can set up Clikgate in a Flutter, React Native, Expo, Android or iOS app, a website or a backend, and then check the result with `npx @clikgate/setup doctor`.

This repository is generated from `clikgate/clikgate-sdks` (`ai-guides/`) on each SDK release. Don't send changes here: open them there.

## Install

### Any assistant (the skills installer)

```sh
npx skills add clikgate/clikgate-skills
```

It asks which assistants to install for. To install without questions:

```sh
npx skills add clikgate/clikgate-skills --skill clikgate-setup -a claude-code -a cursor -a codex -y
```

The installer needs Node.js 22.20 or newer. The setup command itself needs Node.js 18 or newer.

### Claude Code

- With the installer: `npx skills add clikgate/clikgate-skills -a claude-code`. This installs to `.claude/skills/clikgate-setup/` in the project; add `-g` for `~/.claude/skills/`.
- By hand: copy `skills/clikgate-setup/` to `.claude/skills/clikgate-setup/`.
- Use it: ask "Set up Clikgate in this project", or type `/clikgate-setup`.

### Cursor

- With the installer: `npx skills add clikgate/clikgate-skills -a cursor`. This installs to `.agents/skills/clikgate-setup/`.
- Without skills: add the lines from [`AGENTS.md`](AGENTS.md) to the project's `AGENTS.md`. Cursor reads it from the project root.
- Use it: ask Agent "Set up Clikgate in this project".

### Codex

- With the installer: `npx skills add clikgate/clikgate-skills -a codex`. This installs to `.agents/skills/clikgate-setup/`; add `-g` for `~/.agents/skills/`.
- Without skills: add the lines from [`AGENTS.md`](AGENTS.md) to the project's `AGENTS.md`.
- Use it: ask "Set up Clikgate in this project", or mention `$clikgate-setup`.

### No installer

Point the assistant to https://clikgate.com/docs/ai/setup.md, which is the same guide as a single page.

## The prompt

The Clikgate dashboard (Apps › the app › SDK setup › "Set up with AI") gives a ready-made prompt with the app's details filled in:

> Set up Clikgate in this project using the Clikgate setup skill (or https://clikgate.com/docs/ai/setup.md). My Clikgate app is "My App" (Android: com.example.app). Prefer running `npx @clikgate/setup` and let me approve the sign-in in my browser. If you can't, use offline mode with my test SDK key `cg_sdk_test_…` and link domains `go.example.com`. Show me every change before making it, then run `npx @clikgate/setup doctor`.

## What the guide tells the assistant not to do

- put a live SDK key or any API key in app code;
- put a test link domain (`yourapp.dev.ciz.to`) in a release build, or a shared domain (`ciz.to`, `clk.ng`, `clkg.to`, `dev.ciz.to`) in any build;
- add fingerprinting, tracking prompts or IDFA collection (Clikgate needs none of them);
- put customer data in goal calls;
- remove existing deep-link handling;
- call SDK methods that don't exist.

Licence: MIT.
