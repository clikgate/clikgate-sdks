// Which OpenAPI document the server SDK generator reads (Change 21, R.41). Pure path logic, no side effects, so it is
// unit-tested (filter.test.mjs).
//
// The backend writes three documents from Change 21 on: `docs/openapi-public.json` (`public` + `sdk` routes), the only
// one the docs site and this generator read, plus the private dashboard and staff documents. Until a backend checkout
// has it, the generator falls back to the older single `docs/openapi.json` (filtered by `x-clikgate-auth` only).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PUBLIC_SPEC = 'openapi-public.json';
export const LEGACY_SPEC = 'openapi.json';

/** The backend file `--from` copies: `docs/openapi-public.json`, else `docs/openapi.json`. Never a private document. */
export function backendSpec(backendDir, exists = existsSync) {
  const pub = join(backendDir, 'docs', PUBLIC_SPEC);
  if (exists(pub)) return { path: pub, name: PUBLIC_SPEC, fallback: false };
  return { path: join(backendDir, 'docs', LEGACY_SPEC), name: LEGACY_SPEC, fallback: true };
}

/** The vendored copy in server/openapi/ the generator reads: the public document when present, else the legacy one. */
export function vendoredSpec(openapiDir, exists = existsSync) {
  const pub = join(openapiDir, PUBLIC_SPEC);
  if (exists(pub)) return { path: pub, name: PUBLIC_SPEC, fallback: false };
  return { path: join(openapiDir, LEGACY_SPEC), name: LEGACY_SPEC, fallback: true };
}
