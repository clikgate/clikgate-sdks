import type { ConfigCache, GuardState } from './config.js';
import { type ClikgateError } from './errors.js';
import type { Clock, Requester } from './http.js';
import type { Logger, WarningCode } from './logger.js';
import { REDACTED } from './guard.js';

/** What `onError` receives next to the error (SPEC 9.5). Never values, metadata or consent. */
export interface ErrorContext {
  /** `goal`, `goals.batch` or `config`. */
  operation: 'goal' | 'goals.batch' | 'config';
  /** The affected events; references are `[redacted]` while private mode is on. */
  events: Array<{ goal: string; reference: string }>;
  /** True when the events won't be retried. */
  dropped: boolean;
}

/** Called for failures that can't be thrown (background sends and every `goal()` call). */
export type OnError = (error: ClikgateError, context: ErrorContext) => void;

/** @internal State shared by the resources of one client. */
export class Core {
  private warned = new Set<string>();

  constructor(
    readonly requester: Requester,
    readonly logger: Logger,
    readonly clock: Clock,
    readonly privateMode: 'auto' | boolean,
    readonly configCache: ConfigCache,
    private readonly onErrorFn: OnError | undefined,
  ) {}

  /** Warn with a stable code. With `onceKey`, at most once per client for that key. */
  warn(code: WarningCode, message: string, onceKey?: string): void {
    if (onceKey !== undefined) {
      const k = `${code}:${onceKey}`;
      if (this.warned.has(k)) return;
      this.warned.add(k);
    }
    this.logger.warn(message, { code });
  }

  /** Whether the guard is (or may be) on right now, without fetching: used for redaction. */
  mayBePrivate(): boolean {
    if (this.privateMode === true) return true;
    if (this.privateMode === false) return false;
    const cfg = this.configCache.peek();
    return cfg === null || cfg.private_mode;
  }

  /** Resolve the guard state, fetching config in `auto` mode. */
  async guardState(): Promise<GuardState> {
    if (this.privateMode === true) return { guard: true, config: null };
    if (this.privateMode === false) return { guard: false, config: null };
    const config = await this.configCache.get();
    return { guard: config === null || config.private_mode, config };
  }

  /** The reference as it may appear in logs and on_error. */
  shownReference(reference: unknown): string {
    if (this.mayBePrivate()) return REDACTED;
    return typeof reference === 'string' ? reference : String(reference ?? '');
  }

  /** Report a failure that can't be thrown: log at error level and call onError. Never throws. */
  report(error: ClikgateError, context: ErrorContext): void {
    try {
      const who = context.events.map((e) => `${e.goal}:${e.reference}`).join(', ');
      this.logger.error(`Clikgate ${context.operation} failed (${error.name} ${error.code}${error.requestId ? `, request ${error.requestId}` : ''}) for ${who || 'no events'}${context.dropped ? '; dropped' : ''}.`, {
        code: error.code,
        requestId: error.requestId,
      });
    } catch {
      // a broken logger must not break the caller
    }
    if (!this.onErrorFn) return;
    try {
      this.onErrorFn(error, context);
    } catch (err) {
      try {
        this.logger.error(`onError threw: ${err instanceof Error ? err.message : String(err)}`);
      } catch {
        // ignore
      }
    }
  }
}
