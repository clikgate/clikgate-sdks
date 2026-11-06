// Next.js 16+: request middleware is called "proxy". Keeps ?cgid=… in the first-party cookie.
export { clikgateProxy as proxy } from '@clikgate/node/next';

export const config = {
  // everything except Next internals, static files and the webhook route
  matcher: ['/((?!_next/|api/webhooks/|favicon.ico).*)'],
};
