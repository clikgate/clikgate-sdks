# Clikgate server SDKs

| Language | Package | Directory | Status |
|---|---|---|---|
| Node.js / TypeScript | `@clikgate/node` | [`node/`](node/) | 2.0.3, the reference implementation |
| Python | `clikgate` | [`python/`](python/) | 2.0.3: sync and async, Django, Flask, FastAPI/Starlette |
| PHP (+ Laravel) | `clikgate/clikgate-php`, `clikgate/clikgate-laravel` | [`php/`](php/), [`php-laravel/`](php-laravel/) | 2.0.3: PSR-15 middleware, Laravel 12-13 |
| Java (+ Spring Boot) | `com.clikgate:clikgate-java`, `clikgate-servlet-javax`, `clikgate-servlet-jakarta`, `clikgate-spring-boot-starter` | [`java/`](java/), [`java-spring-boot-starter/`](java-spring-boot-starter/) | 2.0.3: Java 8+, Servlet filters, Spring Boot 4 |
| C# / .NET | `Clikgate`, `Clikgate.AspNetCore` | [`dotnet/`](dotnet/) | 2.0.3: netstandard2.0, net8.0, net10.0; ASP.NET Core |

- [`SPEC.md`](SPEC.md) is the shared contract: options, methods, errors, sending modes, retries, idempotency, click IDs, private mode, money, webhooks, the User-Agent and (section 22) payments confirmed by your server: `payments.confirm` and `fromPaystack` / `fromFlutterwave` / `fromMonnify` / `fromStripe`.
- [`conformance/`](conformance/) holds 501 language-neutral cases (122 for payments, with the backend's helper vectors; 7 for the hashed identifiers, `ads_matching`) and the mock server that judges them. Its README documents the runner protocol every SDK implements.
- [`codegen/`](codegen/) generates the `api.*` layer from the backend's public document [`openapi/openapi-public.json`](openapi/) (the `public` audience only; `openapi/openapi.json` until it is synced), with one command (`node server/codegen/generate.mjs --from <path to the backend repository>`) and a drift check (`--check`).

Licence: MIT.
