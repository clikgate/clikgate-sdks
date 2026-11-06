# Generated API layer (`clikgate.api.*`)

One command regenerates every SDK's `api.*` layer from the backend's `openapi.json` (S.16):

```bash
node server/codegen/generate.mjs --from ../clikgate_api   # copy docs/openapi.json, then regenerate
node server/codegen/generate.mjs                          # regenerate from the vendored copy in server/openapi/
node server/codegen/generate.mjs --check                  # CI drift check (exit 1 if anything differs)
node server/codegen/generate.mjs --lang node              # one language
```

You need Java 11+. The pinned OpenAPI Generator JAR is downloaded to `.cache/` once and verified
against the SHA-256 in `generator.json`.

## The pipeline

1. **Sync (`--from`).** Copies the backend's public document `clikgate_api/docs/openapi-public.json` (Change 21, R.41: the `public` and `sdk` routes only) to `server/openapi/openapi-public.json` and removes the legacy `server/openapi/openapi.json`. A backend checkout from before Change 21 has no public document: then `docs/openapi.json` is copied to `server/openapi/openapi.json` as before. The generator reads `server/openapi/openapi-public.json` when it exists, else `openapi.json` (`source.mjs`). The copy is committed, so CI doesn't need the backend repository. Only the public document is used: `generate.mjs` (and `--check`) fails if the copy contains any `/v1/staff` path, `x-clikgate-auth: staff` operation or `x-audience` `staff`, `internal` or `webhook` operation. Never copy `openapi-dashboard.json`, `openapi-staff.json` or the old `openapi.staff.json`.
2. **Filter (`filter.mjs`, shared by all languages).** The backend marks every operation with `x-clikgate-auth` (`api_key`, `dashboard_session`, `staff`, `public`, `sdk_key`, `cli` or `plugin_key`, the WordPress plugin key of change 11). The filter keeps the `api_key` operations only, and drops those with non-JSON request bodies. When the document declares audiences (`x-audience`, Change 21), it also keeps only `x-audience: public`: `sdk` routes (the mobile and web SDK protocol, published in the API reference's "SDK protocol (advanced)" section) are never in the server SDKs, and an operation without an audience is hidden. `/v1/staff`, `/internal` and `/v1/sdk` paths are never generated, whatever their labels. `node --test server/codegen/filter.test.mjs` proves it (also in the drift workflow).

   It also:
   - names each operation from its summary (`List Links` becomes `listLinks`);
   - keeps the schemas reachable from the kept operations;
   - **down-converts OpenAPI 3.1 to 3.0**: `anyOf: [X, null]` becomes `X` + `nullable`; `const` becomes `enum`; numeric `exclusiveMinimum` is rewritten; `examples` are dropped. OpenAPI Generator's 3.1 support is beta and 3.0 is its mature path.

   What was skipped, and why, is in `server/openapi/filter-report.txt`.
3. **Generate.** OpenAPI Generator runs with **custom templates only** (`templates/<lang>/`). The generated methods call the SDK's own request function, so the transport, User-Agent, retries, idempotency keys, typed errors and logging are the hand-written ones (SPEC section 16).
4. **Post-process.** For Node, the per-model and per-API files become one module, `server/node/src/generated/index.ts`, ending with the `ApiClient` aggregator. Resource names come from the tags, through `filter.mjs` `resourceName`.

## Adding a language (Python, PHP, Java, .NET)

1. Add an entry under `languages` in `generator.json`: `generator` (e.g. `python`, `php`, `java`, `csharp`), `templates`, `output`, `type_mappings` and `additional_properties`.
2. Write `templates/<lang>/` so models are plain typed data and every operation calls the SDK's request function. For a starting point, export the stock templates with `java -jar .cache/openapi-generator-cli-*.jar author template -g <generator> -o /tmp/t`.
3. Add a `POSTPROCESS.<lang>` function in `generate.mjs` that maps the raw output to the files to commit.
4. Use the same operation names. They come from `filter.mjs`; don't rename per language beyond the case convention (`listLinks` / `list_links` / `ListLinksAsync`).
5. Add the language to the drift-check workflow (`.github/workflows/server-codegen.yml` runs `--check` for every configured language).

## Generator choice (S.16), decided 2026-10-26

| | OpenAPI Generator 7.26.0 | Kiota 1.36.1 | Speakeasy |
|---|---|---|---|
| Licence and cost | Apache 2.0, free, self-hosted | MIT, free | Commercial SaaS; the free tier is 1 SDK and 50 methods; hooks need Business or Enterprise |
| Our 5 languages | yes (`typescript-fetch`, `python`, `php`, `java`, `csharp`), with Java 8 and .NET Standard 2.0 options | yes, but TypeScript is still "preview" | yes |
| Runtime dependencies | **none**, with custom templates | **required** runtime packages (`@microsoft/kiota-abstractions`, HTTP and serialisation libraries per language). That breaks S.13's "Node zero, Python httpx only, Java Jackson only, .NET none" | Zod and decimal.js in TypeScript, and its own runtime per language |
| Using our transport, retries and errors | full control: the templates call our request function | through Kiota's `RequestAdapter` abstraction (an extra layer per language) | through hooks (`beforeRequest`, `afterError`) on top of its own HTTP layer |
| OpenAPI 3.1 | beta, so we down-convert to 3.0 in `filter.mjs` | supported since 1.24 | supported |
| Runs offline in CI, reproducibly | yes: a pinned JAR with a checked SHA-256 | yes | needs the Speakeasy CLI and an account |

**Choice: OpenAPI Generator with custom templates.**

- It is the only option that meets the dependency budget in S.13 for all five languages.
- It lets the generated layer reuse the hand-written transport, so there is one HTTP stack per SDK.
- It is free and reproducible offline.

The costs are the Java requirement at generation time (not at runtime) and the 3.1 down-conversion, which `filter.mjs` handles.
