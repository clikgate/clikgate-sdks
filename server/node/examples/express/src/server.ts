// Express example: capture → save → send goal → verify webhook.
//   CLIKGATE_API_KEY=cg_test_… CLIKGATE_WEBHOOK_SECRET=whsec_… npx tsx src/server.ts
import express from 'express';
import { Clikgate, webhooks, SignatureVerificationError } from '@clikgate/node';
import { clikgateMiddleware } from '@clikgate/node/express';

const clikgate = new Clikgate(); // create one client and reuse it
const app = express();

// 1. Capture: keeps a click ID that arrives as ?cgid=… in the first-party cookie, and exposes req.clikgate.clickId
app.use(clikgateMiddleware(clikgate));

// 1b. Keep the click ID longer (Safari): the web script's data-server-endpoint="/cg/keep" posts here and this server
// sets the cookie. Same host as the website; only same-origin POSTs with a valid click ID are accepted.
app.all('/cg/keep', clikgate.clickIds.keepRoute({ days: 30 }).express);

// Your own storage (a database in real life)
const applications = new Map<string, { id: string; email: string; clickId: string | null }>();

// 2. Save the click ID with your own record when the visitor signs up
app.post('/applications', express.json(), (req, res) => {
  const id = `APP-${applications.size + 55231}`;
  applications.set(id, { id, email: String(req.body?.email ?? ''), clickId: req.clikgate.clickId });
  res.status(201).json({ id });
});

// 3. Days later, from any job: send the goal (background, never throws, retried safely)
app.post('/applications/:id/approve', (req, res) => {
  const application = applications.get(req.params.id);
  if (!application) return void res.sendStatus(404);
  clikgate.goal('account_opened', {
    clickId: application.clickId,
    reference: application.id, // your unique ID: a resend never counts twice
    value: '2000000', // ₦2,000,000 in normal units, as a decimal string
    currency: 'NGN',
  });
  res.json({ approved: true });
});

// 4. Verify Clikgate webhooks: express.raw keeps the exact bytes that were signed
app.post('/webhooks/clikgate', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const event = webhooks.verify(req.body as Buffer, req.get('Clikgate-Signature'), process.env.CLIKGATE_WEBHOOK_SECRET ?? '');
    if (event.type === 'goal.completed') console.log('goal completed', event.data.object);
    res.sendStatus(200); // dedupe on event.id: delivery is at-least-once
  } catch (err) {
    if (err instanceof SignatureVerificationError) return void res.status(400).send(err.code);
    throw err;
  }
});

const server = app.listen(3000, () => console.log('http://localhost:3000'));
process.on('SIGTERM', () => {
  void clikgate.close().then(() => server.close());
});
