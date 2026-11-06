// 4. Verify Clikgate webhooks. request.text() is the raw body.
import { webhooks, SignatureVerificationError } from '@clikgate/node';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const body = await request.text();
  try {
    const event = webhooks.verify(body, request.headers.get('clikgate-signature'), process.env.CLIKGATE_WEBHOOK_SECRET ?? '');
    if (event.type === 'goal.completed') console.log('goal completed', event.data.object);
    return new Response(null, { status: 200 });
  } catch (err) {
    if (err instanceof SignatureVerificationError) return new Response(err.code, { status: 400 });
    throw err;
  }
}
