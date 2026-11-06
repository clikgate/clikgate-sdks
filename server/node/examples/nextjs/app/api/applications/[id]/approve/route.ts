// 3. Send the goal when it happens, then flush (route handlers can be serverless).
import { applications, clikgate } from '../../../../../lib/clikgate';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const application = applications.get(id);
  if (!application) return new Response(null, { status: 404 });
  clikgate.goal('account_opened', { clickId: application.clickId, reference: application.id, value: '2000000', currency: 'NGN' });
  await clikgate.flush();
  return Response.json({ approved: true });
}
