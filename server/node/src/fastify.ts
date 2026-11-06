/**
 * Fastify plugin: keeps the click ID (SPEC section 17). Works with Fastify 5 (Node 20+).
 *
 * @example
 * import Fastify from 'fastify';
 * import { Clikgate } from '@clikgate/node';
 * import { clikgatePlugin } from '@clikgate/node/fastify';
 *
 * const clikgate = new Clikgate();
 * const app = Fastify();
 * await app.register(clikgatePlugin, { client: clikgate });
 * app.post('/signup', async (request) => {
 *   const clickId = request.clikgate.clickId;
 * });
 *
 * @packageDocumentation
 */
import type { FastifyPluginAsync } from 'fastify';
import { clickIds as defaultClickIds, type PersistOptions } from './click-ids.js';
import type { Clikgate } from './client.js';

/** What the plugin puts on the request. */
export interface ClikgateRequestContext {
  /** The click ID, or `null`. */
  clickId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `clikgatePlugin` from `@clikgate/node/fastify`. */
    clikgate: ClikgateRequestContext;
  }
}

/** Plugin options. */
export interface ClikgatePluginOptions extends PersistOptions {
  /** The client (for the organisation's click-ID parameter). Optional: without it, `cgid`. */
  client?: Clikgate;
  /** Write the cookie when the click ID arrives in the query string (default true). */
  persist?: boolean;
}

const plugin: FastifyPluginAsync<ClikgatePluginOptions> = async (fastify, options) => {
  const { client, persist, ...cookie } = options;
  const helpers = client ? client.clickIds : defaultClickIds;
  if (client) void client.config().catch(() => undefined);
  // v5: reference-type decorators must start as null and be set per request
  fastify.decorateRequest('clikgate', null as unknown as ClikgateRequestContext);
  fastify.addHook('onRequest', async (request, reply) => {
    const clickId = helpers.fromRequest({ url: request.url, headers: request.headers });
    request.clikgate = { clickId };
    if (clickId && persist !== false) {
      const url = new URL(request.url, 'http://localhost');
      if (url.searchParams.getAll(helpers.paramName).includes(clickId)) helpers.persist(reply, clickId, cookie);
    }
  });
};

// What fastify-plugin does, without the dependency: share decorators and hooks with the parent scope.
const meta = plugin as unknown as Record<symbol, unknown>;
meta[Symbol.for('skip-override')] = true;
meta[Symbol.for('fastify.display-name')] = '@clikgate/node/fastify';
meta[Symbol.for('plugin-meta')] = { name: '@clikgate/node/fastify', fastify: '>=5' };

/**
 * Fastify plugin: sets `request.clikgate.clickId` and keeps a click ID from the query string in the
 * `_cg_<param>` cookie.
 *
 * @example
 * await app.register(clikgatePlugin, { client: clikgate, days: 30 });
 */
export const clikgatePlugin: FastifyPluginAsync<ClikgatePluginOptions> = plugin;
export default clikgatePlugin;
