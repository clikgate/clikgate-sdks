import express, { Router, type Request, type Response } from 'express';
import { EventType, SignatureVerificationError, webhooks, type WebhookEvent } from '@clikgate/node';
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
 * Pays referral rewards. `event.asReferral()` gives the referral: its `id`, and the `referrer` and `referee` with
 * `customerId` (your own user IDs; the referee's is null until the app identified them).
 */
export function handleReferralEvent(event: WebhookEvent, rewards: RewardStore): void {
  const referral = event.asReferral(); // null for an event that isn't referral.*
  if (!referral) return;
  const referrerUserId = referral.referrer.customerId;
  const refereeUserId = referral.referee.customerId;

  if (event.type === EventType.ReferralQualified) {
    // Final: pay once. In production, enqueue a job here and answer the webhook straight away.
    rewards.payOnce(referral.id, referrerUserId, refereeUserId);
  } else if (event.type === EventType.ReferralDisqualified) {
    rewards.markDisqualified(referral.id, referrerUserId, refereeUserId); // pay nothing
  }
}
// #endregion
