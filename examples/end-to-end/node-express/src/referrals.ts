import { Router, type Request, type Response } from 'express';
import { signedInUser } from './auth.ts';
import type { Config } from './config.ts';
import type { UserStore } from './users.ts';

export interface ReferralCode {
  code: string;
  link: string;
}

// #region referral-code
/**
 * Gets or creates a user's referrer code in your referral program. The same user always gets the same code, whether
 * your backend or the app's Engage add-on asks first, so there is nothing to check before calling.
 */
export async function getOrCreateReferralCode(config: Config, userId: string): Promise<ReferralCode> {
  // Clikgate SDK 2.1.0: replace with clikgate.referrals.getOrCreateReferrer(...)
  // Until then: the same API call the SDK will make (201 when created, 200 when it already existed).
  const url = `${config.baseUrl}/v1/referral-programs/${encodeURIComponent(config.referralProgramId)}/referrers`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ customer_user_id: userId }), // your own user ID, exactly as the app's identifyUser sends it
  });
  if (!res.ok) throw new Error(`Clikgate referrers call failed with HTTP ${res.status}`);
  const referrer: { code: string; short_url: string } = await res.json();
  return { code: referrer.code, link: referrer.short_url };
}
// #endregion

/**
 * The app calls this when the user opens "Invite friends". The user comes from your own session, so nobody can ask
 * for someone else's code.
 */
export function referralRoutes(users: UserStore, config: Config): Router {
  const router = Router();

  router.get('/me/referral', async (req: Request, res: Response) => {
    const user = signedInUser(req, users);
    if (!user) return res.status(401).json({ error: 'not_signed_in' });
    res.json(await getOrCreateReferralCode(config, user.id)); // {"code": "...", "link": "https://..."}
  });

  return router;
}
