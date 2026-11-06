/**
 * Next.js add-on: keeps the click ID (SPEC section 17). Next.js 16 calls request middleware a
 * "proxy" (`proxy.ts`, exporting `proxy`); `middleware.ts` still works but is deprecated.
 *
 * @example
 * // proxy.ts (Next.js 16+)
 * export { clikgateProxy as proxy } from '@clikgate/node/next';
 * export const config = { matcher: ['/((?!_next/|api/webhooks/).*)'] };
 *
 * // app/signup/route.ts
 * import { cookies } from 'next/headers';
 * import { getClickId } from '@clikgate/node/next';
 * const clickId = getClickId(await cookies());
 *
 * @packageDocumentation
 */
import { NextResponse, type NextRequest } from 'next/server.js';
import { ClickIds, keptMarkerHeader, type KeepRoute, type KeepRouteOptions, type PersistOptions } from './click-ids.js';

/** A cookie store: `request.cookies` or the awaited `cookies()` from `next/headers`. */
export interface CookieStoreLike {
  get(name: string): { value: string } | undefined;
}

/** Options for {@link createClikgateProxy}. */
export interface ClikgateProxyOptions extends PersistOptions {
  /** The click-ID parameter (default `process.env.CLIKGATE_CLICK_ID_PARAM`, else `cgid`). */
  clickIdParam?: string;
}

function helpersFor(param?: string): ClickIds {
  const name = param ?? (typeof process !== 'undefined' ? process.env.CLIKGATE_CLICK_ID_PARAM : undefined) ?? 'cgid';
  return new ClickIds(() => name);
}

/**
 * Add the click-ID cookie to an existing response when the request's query string carries a click ID.
 * Use it inside your own proxy.
 *
 * @example
 * export function proxy(request: NextRequest) {
 *   const response = NextResponse.next();
 *   applyClikgate(request, response);
 *   return response;
 * }
 */
export function applyClikgate(request: NextRequest, response: NextResponse, options: ClikgateProxyOptions = {}): string | null {
  const { clickIdParam, ...cookie } = options;
  const helpers = helpersFor(clickIdParam);
  const fromQuery = request.nextUrl.searchParams.getAll(helpers.paramName).find((v) => helpers.isValid(v)) ?? null;
  if (fromQuery) {
    const secure = cookie.secure ?? request.nextUrl.protocol === 'https:';
    response.headers.append('set-cookie', helpers.cookieHeader(fromQuery, { ...cookie, secure }));
    response.headers.append('set-cookie', keptMarkerHeader({ ...cookie, secure }));
    return fromQuery;
  }
  return helpers.fromRequest({ url: request.nextUrl.href, headers: request.headers });
}

/**
 * Build a proxy (or legacy middleware) function with options.
 *
 * @example
 * export const proxy = createClikgateProxy({ days: 30, clickIdParam: 'ref' });
 */
export function createClikgateProxy(options: ClikgateProxyOptions = {}): (request: NextRequest) => NextResponse {
  return (request) => {
    const response = NextResponse.next();
    applyClikgate(request, response, options);
    return response;
  };
}

/**
 * The ready-made proxy for `proxy.ts`: stores a click ID from the query string in the `_cg_<param>` cookie.
 *
 * @example
 * export { clikgateProxy as proxy } from '@clikgate/node/next';
 */
export const clikgateProxy: (request: NextRequest) => NextResponse = createClikgateProxy();

/**
 * The same function for the deprecated `middleware.ts` (`export { clikgateMiddleware as middleware }`).
 */
export const clikgateMiddleware = clikgateProxy;

/**
 * Read the kept click ID from a cookie store, e.g. `getClickId(await cookies())` in a route handler or
 * server action, or `getClickId(request.cookies)`.
 *
 * @example
 * import { cookies } from 'next/headers';
 * const clickId = getClickId(await cookies());
 */
export function getClickId(store: CookieStoreLike, clickIdParam?: string): string | null {
  const helpers = helpersFor(clickIdParam);
  const value = store.get(helpers.cookieName)?.value;
  return helpers.isValid(value) ? value : null;
}

/**
 * The `/cg/keep` route handler without a client, using the same click-ID parameter as the proxy
 * (`clickIdParam`, else `process.env.CLIKGATE_CLICK_ID_PARAM`, else `cgid`). With a client, use
 * `clikgate.clickIds.keepRoute()` instead.
 *
 * @example
 * // app/cg/keep/route.ts
 * import { keepRoute } from '@clikgate/node/next';
 * export const POST = keepRoute({ days: 90 });
 */
export function keepRoute(options: KeepRouteOptions & { clickIdParam?: string } = {}): KeepRoute {
  const { clickIdParam, ...rest } = options;
  return helpersFor(clickIdParam).keepRoute(rest);
}
