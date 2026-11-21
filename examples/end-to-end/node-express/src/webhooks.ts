import express, { Router, type Request, type Response } from 'express';
import { SignatureVerificationError, webhooks, type WebhookEvent } from '@clikgate/node';
import type { ProcessedEvents, RewardStore } from './rewards.ts';

/**
 * Receives Clikgate webhooks. No sign-in here: the signature check is what protects the route.
 * `express.raw` keeps the body as bytes, because the signature covers the exact bytes Clikgate sent.
 */
export function webhookRoutes(secret: string, processedEvents: ProcessedEvents, rewards: RewardStore): Router {
  const router = Router();

  // #region webhook
  router.post('/webhooks/clikgate', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
    let event: WebhookEvent;
    try {
      event = webhooks.verify(req.body, req.get('Clikgate-Signature'), secret);
    } catch (err) {
      if (err instanceof SignatureVerificationError) return res.status(400).json({ error: err.code });
      throw err;
    }
    if (!processedEvents.markNew(event.id)) return res.sendStatus(200); // a repeat delivery: answer 200, do nothing
    if (event.type.startsWith('referral.')) handleReferralEvent(event, rewards);
    res.sendStatus(200); // answer quickly; Clikgate waits up to 10 seconds
  });
  // #endregion

  return router;
}

// #region referral-event
/**
 * Pays referral rewards. The event's `data.object` is the referral: its `id`, and the `referrer` and `referee` with
 * their `customer_user_id` (your own user IDs).
 */
export function handleReferralEvent(event: WebhookEvent, rewards: RewardStore): void {
  // Clikgate SDK 2.1.0: replace with the typed referral event from the SDK instead of reading the object
  const referral = event.data.object;
  const referralId = text(referral, 'id');
  const referrerUserId = text(referral.referrer, 'customer_user_id');
  const refereeUserId = text(referral.referee, 'customer_user_id');
  if (!referralId || !referrerUserId) return; // not a referral we can pay

  if (event.type === 'referral.qualified') {
    // Final: pay once. In production, enqueue a job here and answer the webhook straight away.
    rewards.payOnce(referralId, referrerUserId, refereeUserId);
  } else if (event.type === 'referral.disqualified') {
    rewards.markDisqualified(referralId, referrerUserId, refereeUserId); // pay nothing
  }
}
// #endregion

function text(node: unknown, key: string): string | null {
  if (typeof node !== 'object' || node === null) return null;
  const value: unknown = Reflect.get(node, key);
  return typeof value === 'string' ? value : null;
}
