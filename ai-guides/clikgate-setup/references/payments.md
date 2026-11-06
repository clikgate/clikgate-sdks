# Payment goals: report from the page or app, confirm from a trusted source

Every goal is **Standard** or **Payment** (its *kind*, set in the dashboard's goal settings: `GoalKind` `standard` / `payment`). A **Payment goal** counts only when a **trusted source confirms the payment**, and its value is the **confirmed amount**. The page or app only **reports** it, with the same `goal()` call as any other goal: gateway (`provider`) plus `reference`, **never an amount**. Clikgate never asks for, or stores, a gateway key that can move money.

- There is one goal method on every platform: `goal()`. There is no separate payment method. The kind is never in the call: it lives only in the goal's settings, so the same call reports a payment on a Payment goal.
- Payment goals need a Starter plan or above (`403 plan_feature_unavailable` on Free). Standard goals work exactly as before.

## 1. Report: one line where the gateway's checkout succeeds

Put the call in the gateway's **success callback**. Report the reference that the gateway's checkout gives back:

- Paystack: `transaction.reference`
- Flutterwave: `tx_ref`
- Monnify: `paymentReference`
- Stripe: `paymentIntent.id` or the Checkout Session id

| Where | Call |
|---|---|
| Website (web script) | `Clikgate.goal("order_paid", { provider: Clikgate.Provider.PAYSTACK, reference: response.reference })`. It returns a promise of `{status, reason}` and never throws. Or opt in to automatic detection with `data-clikgate-payments="auto"` on the script tag: it calls `goal()` with the organisation's default Payment goal. Automatic detection may stop working if the gateway changes its checkout, so the one line is recommended. |
| Android | `Clikgate.goal("order_paid", reference = reference, provider = Provider.PAYSTACK)` |
| iOS | `Clikgate.shared.goal("order_paid", reference: reference, provider: .paystack)` |
| Flutter | `await Clikgate.goal('order_paid', reference: reference, provider: ClikgateProvider.paystack);` |
| React Native | `await Clikgate.goal('order_paid', { reference, provider: ClikgateProvider.Paystack });` |

- The providers are enums generated from Clikgate's gateway list (`Provider`; `ClikgateProvider` on iOS, Flutter and React Native). For a gateway added after the SDK release, use `fromString("...")` (React Native `providerFromString('...')`); the server checks it.
- `provider` and `reference` are required on a Payment goal, from every sender (page, app or server): without them the call is refused (`422 payment_goal_needs_confirmation`, with `missing`).
- Never pass an amount, a currency or customer data. A value sent from a browser or app for a Payment goal is ignored (the result says `value_ignored`).
- The result's `status` is a `GoalStatus`: `counted`, `waiting` (a Payment goal waiting for its confirmation, the normal answer for a report) or `refused`, with a `reason`. In test mode the SDKs log "order_paid is a Payment goal: waiting for confirmation".
- Reports are queued and retried like goals. The same gateway and reference is reported once.
- "Allow from browser" is not needed for a Payment goal, and app event rules can't target one (`422 rule_targets_payment_goal`).
- Mobile reports need install attribution (Growth and up), like app goals. Website reports work from Starter.

## 2. Confirm: the business's trusted source

Pick one route, in this order of preference. Most of them need no code:

1. **Read-only key** (Stripe, Square, Checkout.com): set it up in the dashboard, Integrations › Payments.
2. **Direct webhook with a separate webhook secret** (Flutterwave, Stripe, PayPal, Adyen, Square, Yoco, Peach Payments, Checkout.com): set it up in the dashboard.
3. **WordPress plugin or Shopify app.**
4. **One line on the server, after the server's own verification.** This is the route for a developer. See below.
5. **Forward the gateway webhook** to Clikgate (the sales connection's forward mode).

Paystack has no read-only keys and signs its webhooks with the full secret key. Without WordPress or Shopify, a Paystack business needs route 4 (or 5). Never ask the user for a Paystack, Flutterwave, Monnify or Stripe secret key, and never put one in Clikgate.

## 3. Route 4: the server helpers

Call the helper **right after the business's own server has verified the payment with the gateway**, in the same place it marks the order as paid. That means right after:

- Paystack `GET /transaction/verify/:reference`;
- Flutterwave `GET /v3/transactions/:id/verify`;
- Monnify `GET /api/v2/transactions/:transactionReference`;
- Stripe `paymentIntents.retrieve` or a `checkout.session.completed` webhook that the server already verified.

Pass the gateway's own verified response. The helper reads only these fields:

- the reference;
- the status;
- the amount, as an exact decimal;
- the currency;
- the time;
- the `cg_click_id` metadata.

It sends nothing else. **Never call it with data from the browser or the app.**

```ts clikgate-check
import { Clikgate, GoalStatus, Provider } from '@clikgate/node';

const clikgate = new Clikgate(); // reads CLIKGATE_API_KEY (scope conversions:write)

// Right after your own verification: const verified = await paystack.transaction.verify(reference)
export async function onPaystackVerified(verified: unknown): Promise<void> {
  await clikgate.payments.fromPaystack(verified, { goal: 'order_paid' });
}

// Or send the Payment goal itself with the confirmed value: from your server it is a trusted confirmation.
export async function onOrderPaid(reference: string, clickId: string | null): Promise<void> {
  const event = await clikgate.goals.send('order_paid', { reference, provider: Provider.Paystack, value: '7500', currency: 'NGN', clickId });
  if (event.status === GoalStatus.Waiting) {
    // no click ID: it waits for the page's or app's report, then counts
  }
}

// Any gateway, or your own checks: send the confirmed result yourself.
export async function onRefund(reference: string): Promise<void> {
  await clikgate.payments.confirm({ provider: Provider.Paystack, reference, status: 'refunded', amount: '500', currency: 'NGN' });
}
```

- The four helpers are `fromPaystack`, `fromFlutterwave`, `fromMonnify` and `fromStripe` (a PaymentIntent or a Checkout Session object). Each returns the confirmation, or `null` when there is nothing to send, such as a response it doesn't recognise or a session that needed no payment.
- `goals.send(goal, { reference, provider, value, currency, clickId? })` on a Payment goal from the server is a trusted confirmation with the value sent (`provider`, `reference` and `value` required, `value` above 0; `clickId`, not `code`). The older `POST /v1/conversions` with a Payment goal is the same confirmation and answers with the goal event. With a click ID it counts at once; without one it is `waiting` until the page's or app's report arrives.
- `payments.confirm({ provider, reference, status, amount | amountMinor, currency, occurredAt?, aliases?, clickId?, goal? })` covers every other gateway. `status` is one of `success`, `partial`, `pending`, `failed`, `refunded` or `reversed`.
- Amounts are exact decimals: Node strings, Python `Decimal`, Java `BigDecimal`, .NET `decimal`. Never use floats.
- Refunds: call it again with `status: 'refunded'` and the refunded amount.
- In private mode the helpers still work: every field they send is allowed.
- Python `payments.from_paystack(verified, goal="order_paid")`, PHP `$clikgate->payments->fromPaystack($verified, ['goal' => 'order_paid'])`, Java `clikgate.payments().fromPaystack(verified, ...)`, .NET `await clikgate.Payments.FromPaystackAsync(verified, ...)`. For languages whose SDK isn't available yet ([server-sdks.md](server-sdks.md)), call the HTTP API: `POST https://api.clikgate.com/v1/payments/confirmations` with an API key and the body `{"provider", "reference", "status", "amount" (decimal string), "currency", "occurred_at"?, "click_id"?, "goal"?}`. Send only those fields.

## What the user checks

The dashboard's Payments activity shows each payment as Waiting, Verified, Rejected (with the reason), Not confirmed, Refunded or Disputed. A report that no trusted source confirms within 24 hours becomes **Not confirmed** and doesn't count. The fix is to set up one of the routes above.
