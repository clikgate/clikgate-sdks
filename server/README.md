# Clikgate server SDKs

| Language | Package | Directory | Status |
|---|---|---|---|
| Node.js / TypeScript | `@clikgate/node` | [`node/`](node/) | 1.1.0 (C6-S3, C9), the reference implementation |
| Python | `clikgate` | [`python/`](python/) | 1.1.0 (C6-S4, C9): sync and async, Django, Flask, FastAPI/Starlette |
| PHP (+ Laravel) | `clikgate/clikgate-php`, `clikgate/clikgate-laravel` | [`php/`](php/), [`php-laravel/`](php-laravel/) | 1.1.0 (C6-S4, C9): PSR-15 middleware, Laravel 11-13 |
| Java (+ Spring Boot) | `com.clikgate:clikgate-java`, `clikgate-servlet-javax`, `clikgate-servlet-jakarta`, `clikgate-spring-boot-starter` | [`java/`](java/), [`java-spring-boot-starter/`](java-spring-boot-starter/) | 1.1.0 (C6-S5, C9): Java 8+, Servlet filters, Spring Boot 4 |
| C# / .NET | `Clikgate`, `Clikgate.AspNetCore` | [`dotnet/`](dotnet/) | 1.1.0 (C6-S5, C9): netstandard2.0, net8.0, net10.0; ASP.NET Core |

- [`SPEC.md`](SPEC.md) is the shared contract: options, methods, errors, sending modes, retries, idempotency, click IDs, private mode, money, webhooks, the User-Agent and (section 22, change 11) payments confirmed by your server: `payments.confirm` and `fromPaystack` / `fromFlutterwave` / `fromMonnify` / `fromStripe`.
- [`conformance/`](conformance/) holds 501 language-neutral cases (122 for change 11 payments, with the backend's helper vectors; 7 for the change 19 hashed identifiers, `ads_matching`) and the mock server that judges them. Its README documents the runner protocol every SDK implements.
- [`codegen/`](codegen/) generates the `api.*` layer from the backend's public document [`openapi/openapi-public.json`](openapi/) (the `public` audience only; `openapi/openapi.json` until it is synced), with one command (`node server/codegen/generate.mjs --from ../clikgate_api`) and a drift check (`--check`).

Licence: MIT.
