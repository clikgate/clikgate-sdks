# Clikgate server SDKs and AI guides

This repository holds the **server SDKs + AI guides**. The setup command (`npx @clikgate/setup`) lives with the mobile SDKs in [`clikgate_mobile_sdk`](https://github.com/clikgate/clikgate-mobile-sdk) (`cli/`) since 2026-10-26.

| Part | Directory | Package |
|---|---|---|
| Server SDKs | [`server/`](server/) | `@clikgate/node`, `clikgate` (PyPI), `clikgate/clikgate-php` + `clikgate/clikgate-laravel`, `com.clikgate:clikgate-java` (+ Servlet filters, Spring Boot starter), `Clikgate` + `Clikgate.AspNetCore` (NuGet) |
| AI guides | [`ai-guides/`](ai-guides/) | the `clikgate-setup` skill, published to `clikgate/clikgate-skills` |

Decisions and dated documentation findings are in [`docs/DECISIONS.md`](docs/DECISIONS.md). Licence: [MIT](LICENSE).

## Server SDKs

- `server/SPEC.md`: the contract shared by all five server SDKs.
- `server/conformance/`: cross-language cases and the mock server.
- `server/codegen/`: the generated `api.*` layer (OpenAPI Generator, custom templates).
- `server/node/`: `@clikgate/node`. Install it with `npm install @clikgate/node`.
- `server/python/`: `clikgate`. Install it with `pip install clikgate`, plus the extras `[django]`, `[flask]` and `[fastapi]`.
- `server/php/` and `server/php-laravel/`: install them with `composer require clikgate/clikgate-php` or `composer require clikgate/clikgate-laravel`. Both are split into their own repositories on release.
- `server/dotnet/`: install with `dotnet add package Clikgate` and `dotnet add package Clikgate.AspNetCore`.
- `server/java/` and `server/java-spring-boot-starter/`: `com.clikgate:clikgate-java:1.0.0` (Java 8+), and `com.clikgate:clikgate-spring-boot-starter:1.0.0` (Spring Boot 4).

CI:

- `server-node.yml` / `server-node-release.yml`: Node 18-26; npm trusted publishing with provenance.
- `server-python.yml` / `server-python-release.yml`: Python 3.9-3.15; PyPI trusted publishing with PEP 740 attestations.
- `server-php.yml` / `server-php-release.yml`: PHP 8.1-8.5 and Laravel 11-13; split repositories for Packagist.
- `server-java.yml` / `server-java-release.yml`: Java 8-27; Maven Central with GPG signatures.
- `server-dotnet.yml` / `server-dotnet-release.yml`: .NET 8 and 10, and .NET Framework 4.7.2; NuGet trusted publishing.
- `server-codegen.yml`: the drift check for every generated layer.

All run on Linux and Windows with the conformance suite, and every release attaches a CycloneDX SBOM.

## Setup command (moved)

`@clikgate/setup` moved to `clikgate_mobile_sdk/cli/` on 2026-10-26 (owner decision; still MIT), because it is tightly coupled to the mobile SDKs' versions and APIs. Its docs are `clikgate_mobile_sdk/docs/SETUP_COMMAND.md`, its decisions `clikgate_mobile_sdk/cli/DECISIONS.md`, and its workflows `cli.yml` / `cli-release.yml` are in that repository. The AI guides below still use it: check out `clikgate_mobile_sdk` next to this repository, or set `CLIKGATE_CLI_DIR` to its `cli/` folder.

## AI guides

- `ai-guides/clikgate-setup/` is the source of the **clikgate-setup** skill, in the Agent Skills format. It has `SKILL.md`, plus `references/` for each platform, the web script, server SDKs, goals, test links, the generated `api-surface.md` and troubleshooting.
- `ai-guides/versions.json` holds the SDK versions; `{{versions.*}}` placeholders are resolved at build time.
- `ai-guides/plain/AGENTS.md` holds the lines for projects that can't install skills, and `ai-guides/public/README.md` is the public repository's README, with the install steps for Claude Code, Cursor and Codex.
- Scripts (Node 18+, no dependencies), run from the repository root:
  - `node ai-guides/scripts/check.mjs` validates the skill:
    - the frontmatter;
    - links and versions;
    - every `npx @clikgate/setup` command against the CLI's `--help`;
    - the doctor check IDs and JSON fields;
    - safety rules.

    It reads the setup command from `CLIKGATE_CLI_DIR` (default `../clikgate_mobile_sdk/cli`) and needs its build, `dist/cli.cjs` (`cd ../clikgate_mobile_sdk/cli && npm ci && npm run build`).
  - `node ai-guides/scripts/generate-api-surface.mjs --mobile ../clikgate_mobile_sdk [--web ../clikgate_api/src/static/clikgate.js] [--check]` regenerates `api-surface.md` from the SDK sources. It needs `server/node/dist`.
  - `node ai-guides/scripts/check-code-blocks.mjs --mobile ../clikgate_mobile_sdk [--swift-typecheck]` compiles every ` ```<lang> clikgate-check ` block.
  - `node ai-guides/scripts/build.mjs` writes `ai-guides/dist/`:
    - `clikgate-skills/` for the public repository;
    - `website/`, with `docs/ai/setup.md`, `/.well-known/agent-skills/`, `llms.txt` and `llms-full.txt`.
- QA: `ai-guides/qa/run.sh` runs the headless Claude Code verification on copies of the fixtures (the setup command's, from `CLIKGATE_CLI_DIR`) outside the repositories. Results are in [`docs/AI_GUIDES_QA.md`](docs/AI_GUIDES_QA.md).
- CI: `.github/workflows/ai-guides.yml` runs three jobs:
  - validate, with the setup command from a checkout of `clikgate/clikgate-mobile-sdk`;
  - API-surface drift plus code blocks, against `clikgate/clikgate-mobile-sdk`;
  - publish to `clikgate/clikgate-skills`. This one runs from workflow_dispatch with `publish`, and needs the `SKILLS_DEPLOY_KEY` secret in the `skills` environment.

  It also runs weekly, because changes in `clikgate_mobile_sdk` don't trigger it. `MOBILE_SDK_READ_TOKEN` (read-only Contents on `clikgate/clikgate-mobile-sdk`) is needed only while that repository is private.
