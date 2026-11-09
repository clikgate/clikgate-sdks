<!-- Add these lines to your project's AGENTS.md (read by Codex and Cursor) when you can't install the clikgate-setup skill. -->

## Clikgate

When asked to set up, check or fix Clikgate (deep links, app links on the app's link subdomain (`yourapp.ciz.to`, `yourapp.clk.ng` on the Free plan, `yourapp.dev.ciz.to`) or a custom link domain, the Clikgate SDK, the web script, server SDKs or goal tracking), first read https://clikgate.com/docs/ai/setup.md and follow it exactly. In particular:

- Ask before running `npx @clikgate/setup`, which opens a browser for the user to approve. Otherwise use offline mode with the **test** SDK key: run `npx @clikgate/setup --sdk-key cg_sdk_test_… --domain <domains> --dry-run`, show the plan, then run it again with `--yes`.
- Verify with `npx @clikgate/setup doctor --json --domain <domains>`, and fix every failing check.
- Never put a live SDK key or any API key in app code. Server API keys go in `CLIKGATE_API_KEY`.
- The app's test subdomain (`yourapp.dev.ciz.to`) goes in debug builds only. Never add a shared domain (`ciz.to`, `clk.ng`, `clkg.to`, `dev.ciz.to`): shared domains can't open the app.
- Deep links work on every plan. On Free the release app subdomain is `yourapp.clk.ng` (an app subdomain, not the shared `clk.ng`). Events and goals work on every plan, up to the plan's allowance. Growth and up add re-engagement, Apple Ads, install fraud scoring, and uninstall tracking on Pro. `goal()` is the only method for anything that happens in an app, website or server; a new name counts once the team ticks "Count this as a goal" in the dashboard (until then calls answer `received`, a success).
- Use only the methods listed in the guide's API surface.
- `goal()` is the only goal method. Payment goals: the website or app reports with the same `goal()` call, with `provider` (the `Provider` enum) and `reference`, in the checkout success callback, never with an amount. The server confirms by sending the Payment goal with the value, or with `payments.fromPaystack(verified)` and the other helpers, right after its own verification with the gateway. Results are `counted`, `waiting`, `received` or `refused` (`GoalStatus`). Never ask for or store a gateway secret key.
- Identify users (when asked): by default the server returns an identity token in its sign-in and "current user" responses (`createIdentityToken(user.id)`, secret in `CLIKGATE_IDENTITY_SECRET` on the server only) and the app passes it to `identifyUser()`; or the app sends `getInstallationId()` and the server calls `identifyUser({ appId, installationId, customerId })`. See https://clikgate.com/docs/identify-users.
