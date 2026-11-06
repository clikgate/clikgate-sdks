# Security policy: Clikgate server SDKs

## Reporting a vulnerability

Email **security@clikgate.com** (trust centre: https://clikgate.com/trust). Please don't open a public issue.

- We acknowledge reports within 2 working days and keep you informed until the issue is fixed.
- Include the package and version, a description, and steps to reproduce.
- We credit reporters who want to be named.

## Supported versions

| Package | Supported |
|---|---|
| `Clikgate` and `Clikgate.AspNetCore` (NuGet) 1.x | yes |

Security fixes go to the latest minor version of each supported major version.

## What the SDK does to stay safe

- **No telemetry.** The only identification is the `User-Agent` header (`clikgate-dotnet/<version> (dotnet <version>; <os> <arch>)`).
- **Never logged:** API keys, webhook secrets, request bodies, values, metadata, and (in private mode) references.
- **Private mode.** Fields other than the private-mode allow-list are refused **before** anything is sent. When the SDK can't confirm the organisation's setting, it assumes private mode is on.
- **Webhooks** are verified with HMAC-SHA256 and a constant-time comparison, within a 5-minute replay window.
- **HTTPS only.** `http://` is accepted only for `localhost`. Redirects are never followed.
- **No runtime dependencies** on .NET 8+ (System.Text.Json only on .NET Standard 2.0).
- **Releases** are published from GitHub Actions to NuGet.org with trusted publishing (OIDC, no long-lived API keys), with a CycloneDX SBOM attached to each GitHub release.

## Verifying a release

NuGet.org repository-signs every package. Check the signatures with:

```bash
dotnet nuget verify --all Clikgate.<version>.nupkg
```

The packages are deterministic and Source Link-enabled, so the debugger can fetch the exact sources of the tagged commit.
