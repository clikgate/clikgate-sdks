import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/**
 * A local stand-in for the Clikgate API, so the test never calls the real one. It answers the calls this backend
 * makes with the API's response shapes, and records every request for the test to check.
 */
export class FakeClikgate {
  readonly requests: RecordedRequest[] = [];
  private readonly codesByCustomer = new Map<string, string>();
  private readonly server: Server = createServer((req, res) => void this.handle(req, res));

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  requestsTo(path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.path === path);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const body = text ? JSON.parse(text) : {};
    const path = new URL(req.url ?? '/', 'http://fake').pathname;
    this.requests.push({ method: req.method ?? 'GET', path, authorization: req.headers.authorization, body });

    if (path === '/v1/server-sdk/config') {
      reply(res, 200, { mode: 'test', private_mode: false, goals: [{ key: 'account_opened' }, { key: 'order_paid' }] });
    } else if (path === '/v1/people/identify') {
      reply(res, 200, { object: 'person_identified', person_id: 'per_fake' });
    } else if (path === '/v1/goals/events') {
      reply(res, 201, { object: 'goal_event', id: 'cnv_fake', status: 'counted' });
    } else if (path === '/v1/goals/events/batch') {
      const events: unknown[] = Array.isArray(body.events) ? body.events : [];
      const data = events.map((_, index) => ({ index, ok: true, status: 201, goal_event: { object: 'goal_event', status: 'counted' } }));
      reply(res, 200, { object: 'list', data });
    } else if (path === '/v1/payments/confirmations') {
      reply(res, 201, { ...body, object: 'payment_confirmation', id: 'pcf_fake', match_status: 'matched', duplicate: false });
    } else if (/^\/v1\/referral-programs\/[^/]+\/referrers$/.test(path)) {
      this.referrer(res, String(body.customer_user_id));
    } else {
      reply(res, 404, { error: { code: 'not_found', message: 'Not in the fake.' } });
    }
  }

  /** Same customer, same code: 201 the first time, 200 after that, like the API. */
  private referrer(res: ServerResponse, customerUserId: string): void {
    const created = !this.codesByCustomer.has(customerUserId);
    if (created) this.codesByCustomer.set(customerUserId, `TANGO-${this.codesByCustomer.size + 1}`);
    const code = this.codesByCustomer.get(customerUserId);
    reply(res, created ? 201 : 200, { object: 'referrer', code, customer_user_id: customerUserId, short_url: `https://go.example.com/r/${code}` });
  }
}

function reply(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
}
