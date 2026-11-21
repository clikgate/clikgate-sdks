# End-to-end sample: Python (FastAPI)

The backend of a mobile app with Clikgate added, using `clikgate` (`AsyncClikgate`) and its FastAPI dependency for the
installation header. The routes, and what each one shows, are in [the overview](../README.md).

## Run it

You need Python 3.9 or later.

```bash
# 1. Install (this also installs the SDK from this repository; see "SDK version" below)
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt

# 2. Configure: copy the placeholders and fill in your test keys
cp .env.example .env
set -a; . ./.env; set +a

# 3. Start the backend on http://localhost:8000
.venv/bin/uvicorn app.main:app --port 8000
```

Run the test (it starts a fake Clikgate API, so it never calls the real one):

```bash
.venv/bin/python -m pytest
```

## Where things are

| File | What it shows |
| --- | --- |
| `app/auth.py` | Sign-up, sign-in and `/me` return `clikgateIdentityToken`; sign-up sends a server goal |
| `app/identity.py` | Path A (identity token with the account date) and Path B (`Depends(installation)` and `identify_user`) |
| `app/payments.py` | `payments.from_paystack(...)` after the backend's own check (`verify_with_paystack` is a stub) |
| `app/webhooks.py` | Raw-body verification, the event-ID store, and `handle_referral_event` |
| `app/rewards.py` | The processed-event store and the reward store (pay once per referral) |
| `app/referrals.py` | `GET /me/referral`: get or create the user's referrer code |
| `app/main.py` | One `AsyncClikgate` per process, closed at shutdown so queued goals are sent |
| `tests/test_flow.py` | The whole flow against `tests/fake_clikgate.py` |

Users, sessions, processed events and rewards are kept in memory. Each store's docstring says which table replaces it
in your app.

## SDK version

`requirements.txt` installs the SDK from `server/python` in this repository (`-e ../../../server/python[fastapi]`), so
the sample works before version 2.0.3 is published. At release, replace that line with `clikgate[fastapi]>=2.0.3`.
The referral code and the referral webhook payload are read without SDK helpers for now: look for
`Clikgate SDK 2.1.0` in the code, and switch to the typed methods when you move to version 2.1.0.
