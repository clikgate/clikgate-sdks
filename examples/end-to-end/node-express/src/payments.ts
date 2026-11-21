import { Router, type Request, type Response } from 'express';
import type { Clikgate } from '@clikgate/node';
import { signedInUser } from './auth.ts';
import type { UserStore } from './users.ts';

/** The parts of Paystack's verify response this sample reads. */
export interface PaystackVerifyResponse {
  status: boolean;
  data: { status: string; reference: string; amount: number; currency: string; paid_at: string; metadata: object };
}

/**
 * Your server's own check with Paystack. Stubbed in the sample: it answers like a successful
 * `GET https://api.paystack.co/transaction/verify/{reference}` for ₦7,500, so the sample runs without a Paystack
 * account. In your app, make that request with your Paystack secret key and return the parsed JSON body.
 */
export async function verifyWithPaystack(reference: string): Promise<PaystackVerifyResponse> {
  return {
    status: true,
    data: { status: 'success', reference, amount: 750000, currency: 'NGN', paid_at: '2026-11-20T10:15:00.000Z', metadata: {} },
  };
}

/**
 * The app reports the payment as a Payment goal (provider and reference). Your server confirms it here, after its own
 * check with the gateway, so Clikgate counts the confirmed amount, never an amount sent from the app.
 */
export function paymentRoutes(users: UserStore, clikgate: Clikgate): Router {
  const router = Router();

  router.post('/payments/paystack/confirm', async (req: Request, res: Response) => {
    if (!signedInUser(req, users)) return res.status(401).json({ error: 'not_signed_in' });
    const reference = String(req.body?.reference);
    // #region from-paystack
    const verify = await verifyWithPaystack(reference); // your own check, with your Paystack key
    if (verify.data.status !== 'success') return res.status(402).json({ error: 'payment_not_successful' });
    // ...give the customer what they paid for, then pass Paystack's answer on. Only the reference, status, amount,
    // currency, time and cg_click_id are sent: never customer details.
    await clikgate.payments.fromPaystack(verify, { goal: 'order_paid' });
    // #endregion
    res.json({ status: 'paid', reference });
  });

  return router;
}
