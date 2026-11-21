import { Router, type Request, type Response } from 'express';
import type { Clikgate } from '@clikgate/node';
import { signedInUser } from './auth.ts';
import type { UserStore } from './users.ts';

export interface ReferralCode {
  code: string;
  /** The referrer's short link to share (null when the referrer has no link). */
  link: string | null;
}

// #region referral-code
/**
 * Gets or creates a user's referrer code in your referral program. The same user always gets the same code, whether
 * your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
 */
export async function getOrCreateReferralCode(clikgate: Clikgate, programId: string, userId: string): Promise<ReferralCode> {
  // Your own user ID, exactly as the app's identifyUser sends it. `referrer.created` is true the first time.
  const referrer = await clikgate.referrals.getOrCreateReferrer(programId, { customerId: userId });
  return { code: referrer.code, link: referrer.short_url };
}
// #endregion

/**
 * The app calls this when the user opens "Invite friends". The user comes from your own session, so nobody can ask
 * for someone else's code.
 */
export function referralRoutes(users: UserStore, clikgate: Clikgate, programId: string): Router {
  const router = Router();

  router.get('/me/referral', async (req: Request, res: Response) => {
    const user = signedInUser(req, users);
    if (!user) return res.status(401).json({ error: 'not_signed_in' });
    res.json(await getOrCreateReferralCode(clikgate, programId, user.id)); // {"code": "...", "link": "https://..."}
  });

  return router;
}
