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
  private readonly referrersByCustomer = new Map<string, ReturnType<typeof referrerObject>>();
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
      this.referrer(res, decodeURIComponent(path.split('/')[3]!), String(body.customer_user_id));
    } else {
      reply(res, 404, { error: { code: 'not_found', message: 'Not in the fake.' } });
    }
  }

  /** Same customer, same referrer and code: 201 the first time, 200 after that, like the API. */
  private referrer(res: ServerResponse, programId: string, customerUserId: string): void {
    const created = !this.referrersByCustomer.has(customerUserId);
    if (created) this.referrersByCustomer.set(customerUserId, referrerObject(this.referrersByCustomer.size + 1, programId, customerUserId));
    reply(res, created ? 201 : 200, this.referrersByCustomer.get(customerUserId));
  }
}

const PROGRAM_NAME = 'Invite friends';

/** A referrer as the API returns it (`POST /v1/referral-programs/{id}/referrers`). */
export function referrerObject(n: number, programId: string, customerUserId: string) {
  const code = `TANGO${n}`;
  return {
    id: `rfr_01JCK8Z9V7Q4M2N6P8R0S2T4R${n}`,
    object: 'referrer',
    program_id: programId,
    customer_user_id: customerUserId,
    display_name: null,
    code,
    external_code: null,
    link_id: 'lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA',
    url: `https://go.example.com/r/${code}`,
    short_url: `https://go.example.com/${code.toLowerCase()}`,
    status: 'active',
    blocked_reason: null,
    blocked_at: null,
    stats: { clicks: 0, installs: 0, signups: 0, in_progress: 0, qualified: 0, disqualified: 0, rejected: 0, referee_uninstall_rate_7d: null },
    attributes: {},
    leaderboard_opt_out: false,
    quality_score: null,
    quality_band: null,
    last_activity_at: null,
    created_at: '2026-11-02T09:30:00Z',
    updated_at: '2026-11-02T09:30:00Z',
    livemode: false,
  };
}

/**
 * A `referral.qualified` or `referral.disqualified` webhook event as Clikgate sends it: the envelope, and the referral
 * in `data.object`.
 */
export function referralEvent(eventId: string, type: string, referralId: string, programId: string, referrerUserId: string) {
  const qualified = type === 'referral.qualified';
  return {
    id: eventId,
    object: 'event',
    type,
    api_version: '2026-10-01',
    created_at: '2026-11-03T10:00:00Z',
    organization_id: 'org_01JCK8Z9V7Q4M2N6P8R0S2T4OR',
    livemode: false,
    data: {
      previous_attributes: null,
      object: {
        id: referralId,
        object: 'referral',
        program_id: programId,
        referrer_id: 'rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR',
        status: qualified ? 'qualified' : 'disqualified',
        source: 'link',
        match_type: 'deterministic',
        current_step: qualified ? 2 : 1,
        steps_completed: [
          { index: 0, identify: true, completed_at: '2026-11-02T10:00:00Z', source_id: 'identify:user_friend' },
          ...(qualified ? [{ index: 1, goal: 'order_paid', completed_at: '2026-11-03T09:59:00Z', source_id: 'goal:cnv_01JCK8Z9V7Q4M2N6P8R0S2T4GE' }] : []),
        ],
        step_deadline_at: null,
        hold_until: null,
        qualified_at: qualified ? '2026-11-03T10:00:00Z' : null,
        disqualified_at: qualified ? null : '2026-11-03T10:00:00Z',
        rejected_at: null,
        reason: qualified ? null : 'step_timeout',
        reason_detail: null,
        reason_message: null,
        fraud_flags: [],
        referee_uninstalled_after_qualification: false,
        program: { id: programId, name: PROGRAM_NAME },
        referrer: { id: 'rfr_01JCK8Z9V7Q4M2N6P8R0S2T4RR', customer_user_id: referrerUserId, code: 'TANGO1' },
        referee: { install_id: 'ins_01JCK8Z9V7Q4M2N6P8R0S2T4IN', installation_id: '6a1f0c2e-0000-4000-8000-000000000002', customer_user_id: 'user_friend' },
        link: { id: 'lnk_01JCK8Z9V7Q4M2N6P8R0S2T4AA' },
        click_id: 'clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6',
        ...(qualified ? { reward_snapshot: { referrer: { amount_minor: 100000, currency: 'NGN' }, note: 'Paid by the app' } } : {}),
        created_at: '2026-11-02T09:45:00Z',
        updated_at: '2026-11-03T10:00:00Z',
        livemode: false,
      },
    },
  };
}

function reply(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(json));
}
