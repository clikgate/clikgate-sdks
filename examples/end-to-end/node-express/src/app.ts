import express from 'express';
import { Clikgate } from '@clikgate/node';
import { clikgateMiddleware } from '@clikgate/node/express';
import { authRoutes } from './auth.ts';
import type { Config } from './config.ts';
import { ClikgateIdentity } from './identity.ts';
import { paymentRoutes } from './payments.ts';
import { referralRoutes } from './referrals.ts';
import { ProcessedEvents, RewardStore } from './rewards.ts';
import { UserStore } from './users.ts';
import { webhookRoutes } from './webhooks.ts';

/** Builds the app. Returns the Clikgate client and the reward store too, so the test can look at them. */
export function createApp(config: Config) {
  // One client for the whole process: it is safe to share, and it sends queued goals in the background.
  const clikgate = new Clikgate({ apiKey: config.apiKey, baseUrl: config.baseUrl, identitySecret: config.identitySecret });
  const users = new UserStore();
  const rewards = new RewardStore();
  const identity = new ClikgateIdentity(clikgate, config.identitySecret);

  const app = express();
  // Before express.json(): the webhook route needs the raw body.
  app.use(webhookRoutes(config.webhookSecret, new ProcessedEvents(), rewards));
  app.use(express.json());
  app.use(clikgateMiddleware(clikgate)); // reads the Clikgate-Installation header into req.clikgate.installation
  app.use(authRoutes(users, identity, clikgate));
  app.use(paymentRoutes(users, clikgate));
  app.use(referralRoutes(users, clikgate, config.referralProgramId));

  return { app, clikgate, rewards };
}
