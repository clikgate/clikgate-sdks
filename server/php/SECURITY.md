# Security policy: Clikgate server SDKs

## Reporting a vulnerability

Email **security@clikgate.com** (trust centre: https://clikgate.com/trust). Please don't open a public issue.

- We acknowledge reports within 2 working days and keep you informed until the issue is fixed.
- Include the package and version, a description, and steps to reproduce.
- We credit reporters who want to be named.

## Supported versions

| Package | Supported |
|---|---|
| `clikgate/clikgate-php` and `clikgate/clikgate-laravel` 1.x | yes |

Security fixes go to the latest minor version of each supported major version.

## What the SDK does to stay safe

- **No telemetry.** The only identification is the `User-Agent` header (`clikgate-php/<version> (php <version>; <os> <arch>)`).
- **Never logged:** API keys, webhook secrets, request bodies, values, metadata, and (in private mode) references.
- **Private mode.** Fields other than the private-mode allow-list are refused **before** anything is sent. When the SDK can't confirm the organisation's setting, it assumes private mode is on.
- **Webhooks** are verified with HMAC-SHA256 and a constant-time comparison, within a 5-minute replay window.
- **HTTPS only.** `http://` is accepted only for `localhost`. Redirects are never followed.
- **Runtime dependencies:** PSR interfaces and `php-http/discovery` only.
- **Releases** are published from GitHub Actions from tags in the read-only repositories `clikgate/clikgate-php` and `clikgate/clikgate-laravel` (split by CI from `clikgate/clikgate-sdks`), with a CycloneDX SBOM attached to each GitHub release. Packagist reads those tags.

## Verifying a release

Packagist has no signatures. Check that the tag in `clikgate/clikgate-php` points at the commit of the `server-php-v<version>` tag in `clikgate/clikgate-sdks` (the release notes name it), and compare `composer.lock`'s `dist.reference` with that commit. `composer audit` checks your dependencies against known advisories.
