import { Clikgate } from '@clikgate/node';

// One client per server process. Route handlers may be serverless: `await clikgate.flush()` before returning.
export const clikgate = new Clikgate();

// Your own storage (a database in real life)
export const applications = new Map<string, { id: string; clickId: string | null }>();
