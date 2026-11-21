/**
 * The `Clikgate-Installation` header (SPEC section 24): the mobile SDKs give the app a value
 * `<app_id>:<installation_id>` to send to its own backend at sign-in and on signed-in requests. It is
 * not a secret. Your server passes it to `identifyUser({ installation })`, so it never needs to know
 * which Clikgate app ID belongs to which platform.
 *
 * The header only names the app installation. The customer ID always comes from your own signed-in
 * user, never from the request.
 *
 * @packageDocumentation
 */

/** The header name the app sends to your backend. */
export const INSTALLATION_HEADER = 'Clikgate-Installation';

/** Longer header values are refused before they are looked at. */
export const INSTALLATION_HEADER_MAX_LENGTH = 128;

/** `app_` + a 26-character ID, one colon, a lowercase UUID. */
export const INSTALLATION_PATTERN = /^(app_[0-9A-Z]{26}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** An app installation read from the `Clikgate-Installation` header. */
export interface Installation {
  /** The Clikgate app ID (`app_…`). */
  appId: string;
  /** The SDK's installation ID (a lowercase UUID). */
  installationId: string;
}

/** A request with headers: Node's `IncomingMessage`, Express, Fastify, a Fetch `Request` or `{ headers }`. */
export interface HeadersLike {
  headers?: Headers | Record<string, string | string[] | undefined> | { get(name: string): string | null } | null;
}

/**
 * Parse a `Clikgate-Installation` header value. Returns `null` for anything that isn't exactly
 * `<app_id>:<installation_id>` (after trimming, at most 128 characters, lowercase UUID). Never throws.
 *
 * @example
 * const installation = parseInstallationHeader(req.get('Clikgate-Installation'));
 * // { appId: 'app_01J…', installationId: '3f2b…' } or null
 */
export function parseInstallationHeader(value: unknown): Installation | null {
  if (typeof value !== 'string' || value.length > INSTALLATION_HEADER_MAX_LENGTH) return null;
  const match = INSTALLATION_PATTERN.exec(value.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, ''));
  return match ? { appId: match[1] as string, installationId: match[2] as string } : null;
}

function headerValue(headers: HeadersLike['headers']): unknown {
  if (!headers) return undefined;
  if (typeof (headers as { get?: unknown }).get === 'function') {
    return (headers as { get(name: string): string | null }).get(INSTALLATION_HEADER);
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const wanted = INSTALLATION_HEADER.toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === wanted) {
      const raw = record[key];
      // Several headers with this name: refused, never guessed
      return Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
    }
  }
  return undefined;
}

/**
 * The installation from a request's `Clikgate-Installation` header, or `null` when it is missing or
 * invalid. Never throws.
 *
 * @example
 * const installation = installationFromRequest(req);
 */
export function installationFromRequest(request: HeadersLike | null | undefined): Installation | null {
  try {
    return parseInstallationHeader(headerValue(request?.headers));
  } catch {
    return null;
  }
}

/**
 * @internal An installation from either the raw `Clikgate-Installation` header or a parsed {@link Installation}
 * (`req.clikgate.installation`, `getInstallation(...)`). Both go through the same strict check; anything else is `null`.
 */
export function toInstallation(value: unknown): Installation | null {
  if (typeof value === 'string') return parseInstallationHeader(value);
  if (value && typeof value === 'object') {
    const { appId, installationId } = value as Partial<Installation>;
    if (typeof appId === 'string' && typeof installationId === 'string') return parseInstallationHeader(`${appId}:${installationId}`);
  }
  return null;
}
