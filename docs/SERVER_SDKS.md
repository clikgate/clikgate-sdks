# Server SDK publishing: what the owner enters (S.17)

The full version, covering all five registries, comes with C6-S6. Node.js is ready now.

## npm: `@clikgate/node`

1. **Organisation.** The `@clikgate` npm organisation, with 2FA for every member.
2. **First publish.** npm configures trusted publishing per package, from the package's settings page. If `@clikgate/node` doesn't exist yet:
   - Publish 1.0.0 once by hand from a clean checkout of the tag (`cd server/node && npm ci && npm run build && npm publish --access public`, with 2FA).
   - Or check whether `npm trust` can configure it first.
3. **Trusted publisher.** Package → Settings → Trusted publishing → GitHub Actions:
   - Organisation or user: `clikgate`
   - Repository: `clikgate-sdks`
   - Workflow filename: `server-node-release.yml`
   - Environment: `npm`

   A new configuration must publish successfully within 2 days, or it expires.
4. **GitHub.** Create the environment **`npm`** in the repository (optionally with required reviewers). No secrets are needed: publishing uses OIDC.
5. **Lock it down.** Package → Settings → Publishing access → "Require two-factor authentication and disallow tokens".
6. **Releasing.**
   - Bump `server/node/package.json` and `server/node/src/version.ts` to the same version, and update `CHANGELOG.md`.
   - Tag `server-node-v<version>` and push the tag.
   - The workflow tests, builds, publishes with provenance, and creates the GitHub release with the CycloneDX SBOM.

## PyPI: `clikgate` (Python)

1. **Account.** A PyPI account with 2FA.
2. **Pending publisher** (the project doesn't exist yet). Go to Account → Publishing → "Add a new pending publisher" → GitHub, and enter:
   - PyPI project name: `clikgate`
   - Owner: `clikgate`
   - Repository: `clikgate-sdks`
   - Workflow name: `server-python-release.yml`
   - Environment: `pypi`

   A pending publisher **doesn't reserve the name**, so do the first release soon. After the first upload it becomes a normal trusted publisher.
3. **GitHub.** Create the environment **`pypi`**, optionally with required reviewers. No secrets are needed: publishing uses OIDC, and PEP 740 attestations are made automatically.
4. **Releasing.**
   - Bump `version` in `server/python/pyproject.toml` and `server/python/src/clikgate/_version.py`, and update `CHANGELOG.md`.
   - Tag `server-python-v<version>`.
   - The workflow tests, builds the sdist and wheel, publishes, and attaches the CycloneDX SBOM to the GitHub release.

## Packagist: `clikgate/clikgate-php` and `clikgate/clikgate-laravel` (PHP)

Packagist reads each package from its own Git repository, and public Packagist has no trusted publishing. CI splits the monorepo into read-only repositories.

1. **GitHub repositories.** Create the public repositories `clikgate/clikgate-php` and `clikgate/clikgate-laravel`, each with a short README saying it is a read-only split of `clikgate/clikgate-sdks`.
2. **Deploy keys.** Generate one ed25519 key pair per repository (`ssh-keygen -t ed25519 -C clikgate-php-split -f php_split`).
   - Add each **public** key to its repository: Settings → Deploy keys, with "Allow write access".
3. **Secrets.** In `clikgate/clikgate-sdks`, create the environment **`packagist`** and add the two **private** keys:
   - `PHP_SPLIT_DEPLOY_KEY`
   - `LARAVEL_SPLIT_DEPLOY_KEY`
4. **First release.** Tag `server-php-v1.0.0`. The workflow:
   - tests;
   - pushes `server/php` to `clikgate/clikgate-php` `main` and tags it `v1.0.0`;
   - does the same for `server/php-laravel`;
   - creates the GitHub release with the SBOM.
5. **Packagist.**
   - Sign in with GitHub and **Submit** `https://github.com/clikgate/clikgate-php`, then `https://github.com/clikgate/clikgate-laravel`.
   - Grant the Packagist GitHub app access to the `clikgate` organisation, so new tags update automatically. Without the app, add a webhook to each split repository instead: payload URL `https://packagist.org/api/github?username=<packagist user>`, content type JSON, your Packagist API token as the secret, push events.
6. **Releasing.** Bump `server/php/src/Version.php`, update both `CHANGELOG.md` files, and tag `server-php-v<version>`. Both packages are released together with the same version.

## Maven Central: `com.clikgate:clikgate-java`, `clikgate-servlet-javax`, `clikgate-servlet-jakarta`, `clikgate-spring-boot-starter`

1. **Namespace.** In the Sonatype Central Portal (central.sonatype.com), verify the `com.clikgate` namespace with its DNS TXT record on clikgate.com. Skip this if it was already done for the Android SDK.
2. **User token.** Portal → View Account → Generate User Token.
3. **Signing key.** Create a GPG key for releases and publish its public part to `keys.openpgp.org`. Then export the private key with `gpg --armor --export-secret-keys <id>`. Publish the fingerprint on https://clikgate.com/trust.
4. **GitHub.** Create the environment **`maven-central`** with required reviewers, and add these secrets:
   - `CENTRAL_TOKEN_USERNAME` and `CENTRAL_TOKEN_PASSWORD` (the user token);
   - `GPG_PRIVATE_KEY` (the armored private key);
   - `GPG_PASSPHRASE`.
5. **Releasing.**
   - Bump the version in all five POMs (`server/java/pom.xml`, the three module POMs, and `server/java-spring-boot-starter/pom.xml`) and in `Version.java`. `scripts/check-version.sh` checks that they agree.
   - Update `CHANGELOG.md`, then tag `server-java-v<version>`.
   - The workflow tests, signs, uploads through the Central Portal (`autoPublish`, `waitUntil=published`), and attaches one SBOM per artifact to the GitHub release.

## NuGet: `Clikgate` and `Clikgate.AspNetCore` (.NET)

1. **Account.** A nuget.org account with 2FA. Create an organisation `clikgate` (or use the account) to own the packages.
2. **Prefix reservation.** Email **account@nuget.org** from the owner account. Ask to reserve the ID prefix `Clikgate` (`Clikgate.*`) for the owner `clikgate`.
3. **Trusted publishing policy.** nuget.org → your user menu → Trusted Publishing → Add policy:
   - Policy owner: `clikgate`
   - Repository owner: `clikgate`
   - Repository: `clikgate-sdks`
   - Workflow file: `server-dotnet-release.yml` (the file name only)
   - Environment: `nuget`

   The first successful publish binds the policy to the repository.
4. **GitHub.** Create the environment **`nuget`**, optionally with required reviewers, and add the secret `NUGET_USER`: the nuget.org **profile name**, not the email. No API key is stored: `NuGet/login` exchanges the OIDC token for a key that lives one hour.
5. **Releasing.**
   - Bump `<Version>` in `server/dotnet/Directory.Build.props` and `SdkVersion.Value` in `src/Clikgate/Version.cs` (`scripts/check-version.sh` checks both), and update `CHANGELOG.md`.
   - Tag `server-dotnet-v<version>`.
   - The workflow tests on .NET 8 and 10, packs both packages with symbols, pushes them, and attaches the SBOMs to the GitHub release.
