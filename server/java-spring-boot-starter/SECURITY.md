# Security policy: Clikgate server SDKs

## Reporting a vulnerability

Email **security@clikgate.com** (trust centre: https://clikgate.com/trust). Please don't open a public issue.

- We acknowledge reports within 2 working days and keep you informed until the issue is fixed.
- Include the package and version, a description, and steps to reproduce.
- We credit reporters who want to be named.

## Supported versions

| Package | Supported |
|---|---|
| `com.clikgate:clikgate-java`, `clikgate-spring-boot-starter`, `clikgate-servlet-jakarta`, `clikgate-servlet-javax` 1.x | yes |

Security fixes go to the latest minor version of each supported major version.

## What the SDK does to stay safe

- **No telemetry.** The only identification is the `User-Agent` header (`clikgate-java/<version> (java <version>; <os> <arch>)`).
- **Never logged:** API keys, webhook secrets, request bodies, values, metadata, and (in private mode) references.
- **Private mode.** Fields other than the private-mode allow-list are refused **before** anything is sent. When the SDK can't confirm the organisation's setting, it assumes private mode is on.
- **Webhooks** are verified with HMAC-SHA256 and a constant-time comparison, within a 5-minute replay window.
- **HTTPS only.** `http://` is accepted only for `localhost`. Redirects are never followed.
- **One runtime dependency:** Jackson databind (declared, not shaded).
- **Releases** are published from GitHub Actions to Maven Central (Sonatype Central Portal) from GitHub Actions, with GPG signatures and checksums for every file, and a CycloneDX SBOM attached to each GitHub release.

## Verifying a release

Every file on Maven Central has a `.asc` signature. Import the Clikgate release key (fingerprint published at https://clikgate.com/trust) and check it:

```bash
gpg --verify clikgate-java-<version>.jar.asc clikgate-java-<version>.jar
```

Maven users can also add a signature-checking plugin, such as `org.simplify4u.plugins:pgpverify-maven-plugin`.
