/**
 * Express / Connect middleware: keeps the click ID (SPEC section 17).
 *
 * @example
 * import express from 'express';
 * import { Clikgate } from '@clikgate/node';
 * import { clikgateMiddleware } from '@clikgate/node/express';
 *
 * const clikgate = new Clikgate();
 * const app = express();
 * app.use(clikgateMiddleware(clikgate));
 * app.post('/signup', (req, res) => {
 *   const clickId = req.clikgate.clickId;   // save it with the application
 * });
 *
 * @packageDocumentation
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clickIds as defaultClickIds, type ClickIds, type PersistOptions } from './click-ids.js';
import type { Clikgate } from './client.js';

/** What the middleware puts on the request. */
export interface ClikgateRequestContext {
  /** The click ID from the query, the `_cg_<param>` cookie or the `Clikgate-Click-Id` header; `null` when there is none. */
  clickId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `clikgateMiddleware` from `@clikgate/node/express`. */
      clikgate: ClikgateRequestContext;
    }
  }
}

/** Middleware options. */
export interface ClikgateMiddlewareOptions extends PersistOptions {
  /** Write the cookie when the click ID arrives in the query string (default true; last click wins, like the web script). */
  persist?: boolean;
}

type Next = (err?: unknown) => void;

/** @internal Shared by the add-ons: read, expose and (optionally) persist the click ID. */
export function captureClickId(helpers: ClickIds, req: IncomingMessage & { originalUrl?: string }, res: ServerResponse | object, options: ClikgateMiddlewareOptions): string | null {
  const clickId = helpers.fromRequest(req);
  if (clickId && options.persist !== false) {
    const url = new URL(req.originalUrl ?? req.url ?? '/', 'http://localhost');
    if (url.searchParams.getAll(helpers.paramName).includes(clickId)) {
      const { persist: _p, ...cookie } = options;
      helpers.persist(res, clickId, cookie);
    }
  }
  return clickId;
}

/**
 * Express/Connect middleware: sets `req.clikgate.clickId`, and stores a click ID that arrives in
 * the query string in the first-party `_cg_<param>` cookie. Pass the client so the organisation's
 * click-ID parameter is used; without it, `cgid`.
 *
 * @example
 * app.use(clikgateMiddleware(clikgate, { days: 30 }));
 */
export function clikgateMiddleware(client?: Clikgate | null, options: ClikgateMiddlewareOptions = {}): (req: IncomingMessage, res: ServerResponse, next: Next) => void {
  const helpers = client ? client.clickIds : defaultClickIds;
  let warmed = false;
  return (req, res, next) => {
    try {
      if (client && !warmed) {
        warmed = true;
        // learn the organisation's click_id_param in the background; never blocks a request
        void client.config().catch(() => undefined);
      }
      const clickId = captureClickId(helpers, req, res, options);
      (req as IncomingMessage & { clikgate?: ClikgateRequestContext }).clikgate = { clickId };
      next();
    } catch (err) {
      next(err);
    }
  };
}
