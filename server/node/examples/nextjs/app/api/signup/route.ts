// 2. Save the click ID with your own record.
import { cookies } from 'next/headers';
import { getClickId } from '@clikgate/node/next';
import { applications } from '../../../lib/clikgate';

export async function POST(): Promise<Response> {
  const clickId = getClickId(await cookies());
  const id = `APP-${applications.size + 55231}`;
  applications.set(id, { id, clickId });
  return Response.json({ id }, { status: 201 });
}
