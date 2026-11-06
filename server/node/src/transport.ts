import * as http from 'node:http';
import * as https from 'node:https';
import type * as net from 'node:net';
import * as tls from 'node:tls';
import { NetworkError, TimeoutError } from './errors.js';

/** @internal One HTTP attempt. */
export interface TransportRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  timeoutMs: number;
}

/** @internal The raw answer of one attempt. Header names are lowercase. */
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** @internal Sends one attempt; throws NetworkError or TimeoutError. */
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** A `fetch`-compatible function (the global `fetch`, undici's, or a wrapper adding mTLS or tracing). */
export type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; body?: Uint8Array; signal: AbortSignal; redirect: 'manual' }) => Promise<{
  status: number;
  headers: { forEach(cb: (value: string, key: string) => void): void };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const timeoutError = (ms: number) => new TimeoutError({ message: `The request timed out after ${ms} ms.`, code: 'timeout' });
const networkError = (cause: unknown) =>
  new NetworkError({
    message: `Could not reach the Clikgate API: ${cause instanceof Error ? cause.message.replace(/\/\/[^@/]*@/g, '//***@') : 'connection failed'}`,
    code: 'network_error',
  });

/** @internal Wrap a fetch-compatible function as a Transport. */
export function fetchTransport(fetchFn: FetchLike): Transport {
  return async (req) => {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, req.timeoutMs);
    try {
      const res = await fetchFn(req.url, { method: req.method, headers: req.headers, body: req.body, signal: controller.signal, redirect: 'manual' });
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const body = new Uint8Array(await res.arrayBuffer());
      return { status: res.status, headers, body };
    } catch (err) {
      if (timedOut) throw timeoutError(req.timeoutMs);
      throw networkError(err);
    } finally {
      clearTimeout(timer);
    }
  };
}

/** @internal Resolve the proxy for a target URL from the option or the environment. */
export function resolveProxy(target: URL, option: string | false | undefined, env: NodeJS.ProcessEnv = process.env): URL | null {
  if (option === false) return null;
  const raw = option ?? (target.protocol === 'https:' ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy : env.HTTP_PROXY ?? env.http_proxy);
  if (!raw) return null;
  if (option === undefined) {
    const noProxy = (env.NO_PROXY ?? env.no_proxy ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const host = target.hostname.toLowerCase();
    if (noProxy.some((p) => p === '*' || host === p.replace(/^\./, '') || host.endsWith(p.startsWith('.') ? p : `.${p}`))) return null;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return null;
  }
  try {
    return new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    return null;
  }
}

function proxyAuth(proxy: URL): Record<string, string> {
  if (!proxy.username) return {};
  const cred = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return { 'proxy-authorization': `Basic ${Buffer.from(cred).toString('base64')}` };
}

/** Open a CONNECT tunnel through the proxy and return a TLS socket to the target. */
function tunnel(proxy: URL, target: URL, timeoutMs: number): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const port = Number(target.port || 443);
    const connectReq = (proxy.protocol === 'https:' ? https : http).request({
      host: proxy.hostname,
      port: Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80)),
      method: 'CONNECT',
      path: `${target.hostname}:${port}`,
      headers: { host: `${target.hostname}:${port}`, ...proxyAuth(proxy) },
      timeout: timeoutMs,
    });
    connectReq.once('connect', (res, socket: net.Socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT answered ${res.statusCode ?? 'nothing'}`));
        return;
      }
      const secure = tls.connect({ socket, servername: target.hostname });
      secure.once('secureConnect', () => resolve(secure));
      secure.once('error', reject);
    });
    connectReq.once('timeout', () => connectReq.destroy(new Error('proxy timeout')));
    connectReq.once('error', reject);
    connectReq.end();
  });
}

const agents = { http: new http.Agent({ keepAlive: true }), https: new https.Agent({ keepAlive: true }) };

/** @internal The built-in transport: node:http(s), keep-alive, optional CONNECT proxy, no redirects. */
export function nodeTransport(proxyOption?: string | false): Transport {
  return (req) =>
    new Promise<TransportResponse>((resolve, reject) => {
      const target = new URL(req.url);
      const proxy = resolveProxy(target, proxyOption);
      let settled = false;
      let timedOut = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(timedOut ? timeoutError(req.timeoutMs) : err instanceof NetworkError || err instanceof TimeoutError ? err : networkError(err));
      };
      let active: http.ClientRequest | null = null;
      const timer = setTimeout(() => {
        timedOut = true;
        active?.destroy();
        fail(timeoutError(req.timeoutMs));
      }, req.timeoutMs);

      const send = (socket?: tls.TLSSocket) => {
        const isHttps = target.protocol === 'https:';
        const options: https.RequestOptions = {
          method: req.method,
          host: target.hostname.replace(/^\[|\]$/g, ''),
          port: target.port || (isHttps ? 443 : 80),
          path: `${target.pathname}${target.search}`,
          headers: { ...req.headers, ...(req.body ? { 'content-length': String(req.body.byteLength) } : {}) },
        };
        if (socket) {
          options.createConnection = () => socket;
          options.agent = false;
        } else {
          options.agent = isHttps ? agents.https : agents.http;
        }
        if (proxy && !isHttps) {
          // plain-HTTP targets through a proxy use an absolute-form request
          options.host = proxy.hostname;
          options.port = Number(proxy.port || 80);
          options.path = target.toString();
          options.headers = { ...options.headers, ...proxyAuth(proxy) };
        }
        const r = (isHttps && !socket ? https : http).request(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
            resolve({ status: res.statusCode ?? 0, headers, body: new Uint8Array(Buffer.concat(chunks)) });
          });
          res.on('error', fail);
          res.on('aborted', () => fail(new Error('response aborted')));
        });
        active = r;
        r.on('error', fail);
        if (req.body) r.write(req.body);
        r.end();
      };

      if (proxy && target.protocol === 'https:') {
        tunnel(proxy, target, req.timeoutMs).then(send, fail);
      } else send();
    });
}
