# Security policy: Clikgate server SDKs

## Reporting a vulnerability

Email **security@clikgate.com** (trust centre: https://clikgate.com/trust). Please don't open a public issue.

- We acknowledge reports within 2 working days and keep you informed until the issue is fixed.
- Include the package and version, a description, and steps to reproduce.
- We credit reporters who want to be named.

## Supported versions

| Package | Supported |
|---|---|
| `clikgate` (PyPI) 1.x | yes |

Security fixes go to the latest minor version of each supported major version.

## What the SDK does to stay safe

- **No telemetry.** The only identification is the `User-Agent` header (`clikgate-python/<version> (python <version>; <os> <arch>)`).
- **Never logged:** API keys, webhook secrets, request bodies, values, metadata, and (in private mode) references.
- **Private mode.** Fields other than the private-mode allow-list are refused **before** anything is sent. When the SDK can't confirm the organisation's setting, it assumes private mode is on.
- **Webhooks** are verified with HMAC-SHA256 and a constant-time comparison, within a 5-minute replay window.
- **HTTPS only.** `http://` is accepted only for `localhost`. Redirects are never followed.
- **One runtime dependency:** `httpx`.
- **Releases** are published from GitHub Actions with PyPI trusted publishing (OIDC, no tokens) and PEP 740 attestations, with a CycloneDX SBOM attached to each GitHub release.

## Verifying a release

Each file on PyPI has a PEP 740 attestation, made by the GitHub Actions workflow `server-python-release.yml` in `clikgate/clikgate-sdks`. Check it on the file's page on pypi.org ("Provenance"), or with the PyPI Integrity API:

```bash
curl -s https://pypi.org/integrity/clikgate/<version>/<file name>/provenance
```
