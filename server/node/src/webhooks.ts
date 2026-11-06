import { createHmac, timingSafeEqual } from 'node:crypto';
import { SignatureVerificationError, localError } from './errors.js';
import type { WebhookEvent } from './types.js';

/** Options for webhook verification. */
export interface VerifyOptions {
  /** Maximum age (and future skew) of the signature timestamp, in seconds. Default 300. `0` disables the check (tests only). */
  tolerance?: number;
  /** The current time in unix seconds (for tests). Default: now. */
  now?: number;
}

/** The raw request body exactly as received. */
export type RawBody = string | Uint8Array | ArrayBuffer;

const fail = (code: string, message: string) => new SignatureVerificationError({ message, code });

function toBytes(raw: unknown): Uint8Array {
  if (typeof raw === 'string') return new TextEncoder().encode(raw);
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  throw fail('invalid_payload', 'Pass the raw request body (a string or Buffer), not parsed JSON: re-serialising changes the bytes Clikgate signed.');
}

function parseHeader(header: unknown): { t: number; v1: string[] } {
  if (typeof header !== 'string' || header.trim() === '') throw fail('missing_signature', 'The Clikgate-Signature header is missing.');
  let t: number | null = null;
  let bad = false;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const p = part.trim();
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const key = p.slice(0, eq).trim();
    const value = p.slice(eq + 1).trim();
    if (key === 't') {
      if (/^\d+$/.test(value)) t = Number(value);
      else bad = true;
    } else if (key === 'v1') v1.push(value);
  }
  if (bad || t === null || v1.length === 0) throw fail('malformed_signature', 'The Clikgate-Signature header is malformed (expected t=<unix seconds>,v1=<hex>).');
  return { t, v1 };
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function verifyWith(rawBody: RawBody, signatureHeader: string | null | undefined, secrets: string[], options: VerifyOptions): WebhookEvent {
  const body = toBytes(rawBody);
  const { t, v1 } = parseHeader(signatureHeader);
  const tolerance = options.tolerance ?? 300;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (tolerance > 0 && Math.abs(now - t) > tolerance) {
    throw fail('timestamp_outside_tolerance', `The signature timestamp is more than ${tolerance} s from now; the request may be a replay, or this server's clock is wrong.`);
  }
  const matched = secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex');
    return v1.some((candidate) => safeEqualHex(expected, candidate));
  });
  if (!matched) throw fail('no_matching_signature', 'No signature matches: check the endpoint secret, and that you pass the raw body.');
  let event: unknown;
  try {
    event = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw fail('invalid_payload', 'The body is not JSON.');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw fail('invalid_payload', 'The body is not an event object.');
  return event as WebhookEvent;
}

/**
 * Webhook verification: `Clikgate-Signature: t=<unix>,v1=<hex>`,
 * `hex = HMAC-SHA256(secret, "<t>." + raw body)`. No API key or client needed.
 */
export const webhooks = {
  /**
   * Verify a delivery and return the parsed event. Throws {@link SignatureVerificationError}.
   *
   * @example
   * import express from 'express';
   * import { webhooks } from '@clikgate/node';
   * app.post('/webhooks/clikgate', express.raw({ type: 'application/json' }), (req, res) => {
   *   const event = webhooks.verify(req.body, req.get('Clikgate-Signature'), process.env.CLIKGATE_WEBHOOK_SECRET!);
   *   if (event.type === 'goal.completed') { … }   // dedupe on event.id: delivery is at-least-once
   *   res.sendStatus(200);
   * });
   */
  verify<T = Record<string, unknown>>(rawBody: RawBody, signatureHeader: string | null | undefined, secret: string, options: VerifyOptions = {}): WebhookEvent<T> {
    if (typeof secret !== 'string' || secret.length === 0) throw localError('invalid_argument', 'secret must be the endpoint secret (whsec_…).', 'secret');
    return verifyWith(rawBody, signatureHeader, [secret], options) as WebhookEvent<T>;
  },

  /**
   * Like {@link webhooks.verify}, accepting any of several secrets (while you rotate your own).
   *
   * @example
   * const event = webhooks.verifyAny(req.body, req.get('Clikgate-Signature'), [newSecret, oldSecret]);
   */
  verifyAny<T = Record<string, unknown>>(rawBody: RawBody, signatureHeader: string | null | undefined, secrets: string[], options: VerifyOptions = {}): WebhookEvent<T> {
    if (!Array.isArray(secrets) || secrets.length === 0 || secrets.some((s) => typeof s !== 'string' || s.length === 0)) {
      throw localError('invalid_argument', 'secrets must be a non-empty list of endpoint secrets.', 'secrets');
    }
    return verifyWith(rawBody, signatureHeader, secrets, options) as WebhookEvent<T>;
  },
};
