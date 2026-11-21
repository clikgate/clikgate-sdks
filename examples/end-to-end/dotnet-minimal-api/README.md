# End-to-end sample: .NET (ASP.NET Core minimal API)

The backend of a mobile app with Clikgate added, using `Clikgate.AspNetCore` (`AddClikgate()` and
`HttpContext.GetClikgateInstallation()`). The routes, and what each one shows, are in [the overview](../README.md).

## Run it

You need the .NET 10 SDK.

```bash
# 1. Configure: copy the placeholders and fill in your test keys
cp .env.example .env
set -a; . ./.env; set +a

# 2. Start the backend on http://localhost:5000 (this builds the SDK from this repository too)
dotnet run --project src/Sample
```

Run the test (it starts a fake Clikgate API, so it never calls the real one):

```bash
dotnet test --project tests/Sample.Tests
```

## Where things are

| File | What it shows |
| --- | --- |
| `src/Sample/AuthEndpoints.cs` | Sign-up, sign-in and `/me` return `clikgateIdentityToken`; sign-up sends a server goal |
| `src/Sample/ClikgateIdentity.cs` | Path A (identity token with the account date) and Path B (`GetClikgateInstallation()` and `IdentifyUserAsync`) |
| `src/Sample/PaymentEndpoints.cs` | `Payments.FromPaystackAsync(...)` after the backend's own check (`VerifyWithPaystack` is a stub) |
| `src/Sample/WebhookEndpoints.cs` | Raw-body verification, the event-ID store, and `HandleReferralEvent` |
| `src/Sample/Rewards.cs` | The processed-event store and the reward store (pay once per referral) |
| `src/Sample/ReferralCodes.cs` | `GET /me/referral`: get or create the user's referrer code |
| `src/Sample/SampleApp.cs` | `AddClikgate(...)` from the environment, and the endpoint wiring |
| `tests/Sample.Tests/EndToEndFlowTest.cs` | The whole flow against `FakeClikgate.cs` |

Users, sessions, processed events and rewards are kept in memory. Each store's comment says which table replaces it in
your app.

## SDK version

`src/Sample/Sample.csproj` references `server/dotnet/src/Clikgate.AspNetCore` in this repository with a
`ProjectReference`, so the sample builds before version 2.0.3 is on NuGet. At release, replace it with
`<PackageReference Include="Clikgate.AspNetCore" Version="2.0.3" />`. The referral code and the referral webhook
payload are read without SDK helpers for now: look for `Clikgate SDK 2.1.0` in the code, and switch to the typed
methods when you move to version 2.1.0.
