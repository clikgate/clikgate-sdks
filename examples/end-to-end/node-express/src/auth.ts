import { Router, type Request, type Response } from 'express';
import type { Clikgate } from '@clikgate/node';
import type { ClikgateIdentity } from './identity.ts';
import type { AppUser, UserStore } from './users.ts';

/**
 * Resolves "Authorization: Bearer <access token>" to the signed-in user. Stands in for your real authentication.
 * Everything Clikgate needs about the user comes from here, never from the request body.
 */
export function signedInUser(req: Request, users: UserStore): AppUser | null {
  const header = req.get('Authorization') ?? '';
  return header.startsWith('Bearer ') ? users.findBySession(header.slice('Bearer '.length)) : null;
}

/** Sign-up, sign-in and "current user": the three responses that tell the app who is signed in. */
export function authRoutes(users: UserStore, identity: ClikgateIdentity, clikgate: Clikgate): Router {
  const router = Router();

  // Every response that says who is signed in carries the token (null without an identity secret).
  const session = (user: AppUser) => ({
    user,
    accessToken: users.startSession(user),
    clikgateIdentityToken: identity.identityToken(user),
  });

  router.post('/auth/sign-up', async (req: Request, res: Response) => {
    const user = users.create(String(req.body?.email), String(req.body?.password));
    if (!user) return res.status(409).json({ error: 'email_taken' });
    await identity.identifyInstallation(user, req.clikgate.installation);
    // #region server-goal
    // A goal only your server knows about. goal() never throws: it is queued and sent in the background, and the
    // reference (your own ID for the event) makes a resend count once.
    clikgate.goal('account_opened', { reference: user.id });
    // #endregion
    res.status(201).json(session(user));
  });

  router.post('/auth/sign-in', async (req: Request, res: Response) => {
    const user = users.signIn(String(req.body?.email), String(req.body?.password));
    if (!user) return res.status(401).json({ error: 'invalid_credentials' });
    await identity.identifyInstallation(user, req.clikgate.installation); // only after your own sign-in check
    res.json(session(user));
  });

  // The app calls this at every open, so it gets a fresh token and Path B runs again within Clikgate's 7 days.
  router.get('/me', async (req: Request, res: Response) => {
    const user = signedInUser(req, users);
    if (!user) return res.status(401).json({ error: 'not_signed_in' });
    await identity.identifyInstallation(user, req.clikgate.installation);
    res.json({ user, clikgateIdentityToken: identity.identityToken(user) });
  });

  return router;
}
