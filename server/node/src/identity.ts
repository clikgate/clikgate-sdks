import { createHmac } from 'node:crypto';
import { ClikgateServerOnlyError, ConfigurationError, localError } from './errors.js';

/**
 * Identity tokens (SDK spec 8.5): your server proves to Clikgate that a customer ID belongs to the
 * person signed in to your app. The app passes the token to the mobile SDK's `identifyUser()`.
 *
 * `token = base64url_nopad(HMAC_SHA256(secret, customerId + "." + issuedAt)) + "." + issuedAt`, the same signer
 * Clikgate verifies with. No network call. Guide: https://clikgate.com/docs/identify-users
 */
export interface IdentityTokenOptions {
  /** The Clikgate app ID (`app_…`). Picks that app's secret from `identitySecrets` / `CLIKGATE_IDENTITY_SECRETS`. */
  appId?: string | null;
  /** The identity secret to sign with. Default: the app's secret from the map, else `CLIKGATE_IDENTITY_SECRET`. */
  secret?: string | null;
  /** Unix seconds the token was issued at. Default: now. */
  issuedAt?: number;
}

/** @internal Where the secrets come from (the client's options, else the environment). */
export interface IdentitySecretSource {
  identitySecret?: string | null;
  identitySecrets?: Readonly<Record<string, string>> | null;
}

/** The single secret's environment variable. */
export const IDENTITY_SECRET_ENV = 'CLIKGATE_IDENTITY_SECRET';
/** The per-app map's environment variable: a JSON object `{"app_…": "cgis_…"}`. */
export const IDENTITY_SECRETS_ENV = 'CLIKGATE_IDENTITY_SECRETS';

const MAX_CUSTOMER_ID = 255;

/** @internal True in a browser (window or document) or React Native. */
export function isBrowserOrMobile(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): boolean {
  if (typeof g.window !== 'undefined' || typeof g.document !== 'undefined') return true;
  const nav = g.navigator as { product?: unknown } | undefined;
  return typeof nav === 'object' && nav !== null && nav.product === 'ReactNative';
}

function serverOnly(): never {
  throw new ClikgateServerOnlyError({
    message: 'createIdentityToken() runs on your server only: it needs your identity secret, which must never be in an app or website. Return the token from your sign-in response instead. See https://clikgate.com/docs/identify-users',
    code: 'server_only',
  });
}

function envMap(): Record<string, string> | null {
  const raw = process.env[IDENTITY_SECRETS_ENV];
  if (raw === undefined || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !Object.values(parsed).every((v) => typeof v === 'string' && v !== '')) {
    // Never echo the value: it holds secrets.
    throw new ConfigurationError({ message: `${IDENTITY_SECRETS_ENV} must be a JSON object of app IDs to identity secrets, e.g. {"app_…": "cgis_…"}.`, code: 'invalid_identity_secrets', param: IDENTITY_SECRETS_ENV });
  }
  return parsed as Record<string, string>;
}

function resolveSecret(options: IdentityTokenOptions, source: IdentitySecretSource): string {
  if (options.secret != null && options.secret !== '') return options.secret;
  const appId = options.appId ?? null;
  const map = source.identitySecrets ?? envMap();
  if (appId !== null && map && Object.prototype.hasOwnProperty.call(map, appId) && map[appId]) return map[appId] as string;
  const single = source.identitySecret || process.env[IDENTITY_SECRET_ENV] || null;
  if (single) return single;
  if (appId === null && map && Object.keys(map).length > 0) {
    throw new ConfigurationError({ message: `Several apps' identity secrets are set (${IDENTITY_SECRETS_ENV}): pass { appId } to choose one.`, code: 'missing_identity_secret', param: 'appId' });
  }
  throw new ConfigurationError({
    message: appId === null
      ? `No identity secret: set ${IDENTITY_SECRET_ENV} on your server (Apps › your app › Identity secret).`
      : `No identity secret for this app: add it to ${IDENTITY_SECRETS_ENV} or set ${IDENTITY_SECRET_ENV}.`,
    code: 'missing_identity_secret',
    param: 'secret',
  });
}

/** @internal */
export function signIdentityToken(secret: string, customerId: string, issuedAt: number): string {
  const sig = createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(`${customerId}.${issuedAt}`, 'utf8')).digest('base64url');
  return `${sig}.${issuedAt}`;
}

/** @internal createIdentityToken with an explicit secret source (the client's options). */
export function createIdentityTokenWith(source: IdentitySecretSource, customerId: string, options: IdentityTokenOptions = {}): string {
  if (isBrowserOrMobile()) serverOnly();
  if (typeof customerId !== 'string' || customerId === '' || [...customerId].length > MAX_CUSTOMER_ID) {
    // Never echo the customer ID.
    throw localError('invalid_customer_id', 'customerId must be your own user ID as a string of 1-255 characters (never an email or phone number).', 'customer_id');
  }
  const o = options ?? {};
  const issuedAt = o.issuedAt ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0) throw localError('invalid_argument', 'issuedAt must be whole Unix seconds.', 'issued_at');
  return signIdentityToken(resolveSecret(o, source), customerId, issuedAt);
}

/**
 * Create an identity token for the signed-in user. Return it in your sign-in and "current user"
 * responses; the app passes it to `identifyUser()`. Reads `CLIKGATE_IDENTITY_SECRET`, or with `appId` the app's
 * secret from `CLIKGATE_IDENTITY_SECRETS` (a JSON map). No network call; no API key needed.
 *
 * Throws {@link ClikgateServerOnlyError} in a browser or React Native, `ConfigurationError` when no secret is set,
 * and `InvalidRequestError` (`invalid_customer_id`) for an empty or over-long customer ID.
 *
 * @example
 * import { createIdentityToken } from '@clikgate/node';
 * res.json({ user, clikgateIdentityToken: createIdentityToken(user.id) });
 */
export function createIdentityToken(customerId: string, options: IdentityTokenOptions = {}): string {
  return createIdentityTokenWith({}, customerId, options);
}
