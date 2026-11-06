import { Clikgate, type ClikgateOptions, type FetchLike } from '../../src/index.js';

export interface Captured {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** A capturing fetch-compatible transport answering from a script. */
export function capture(answers: Array<{ status: number; json?: unknown; text?: string; headers?: Record<string, string> }> = []) {
  const calls: Captured[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ method: init.method, url, headers: init.headers, body: init.body ? new TextDecoder().decode(init.body) : '' });
    const a = answers.shift() ?? { status: 200, json: {} };
    const text = a.json !== undefined ? JSON.stringify(a.json) : (a.text ?? '');
    const headers = new Headers({ 'content-type': 'application/json', ...(a.headers ?? {}) });
    return { status: a.status, headers, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  };
  return { calls, fetchLike };
}

export const KEY = 'cg_test_unit000000';

export function client(fetchLike: FetchLike, extra: ClikgateOptions = {}): Clikgate {
  return new Clikgate({
    apiKey: KEY,
    httpClient: fetchLike,
    privateMode: false,
    sendMode: 'sync',
    shutdownHooks: false,
    logger: { warn: () => undefined, error: () => undefined },
    clock: { now: () => Date.now(), sleep: () => Promise.resolve() },
    ...extra,
  });
}
