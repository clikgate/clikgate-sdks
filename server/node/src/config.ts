import type { Clock } from './http.js';
import type { Requester } from './http.js';
import type { Logger } from './logger.js';
import type { ServerSdkConfig } from './types.js';
import { VERSION } from './version.js';

/** How long a fetched config is used (SPEC 12.1). */
export const CONFIG_TTL_MS = 10 * 60 * 1000;
/** How long to wait after a failed config fetch. */
export const CONFIG_RETRY_MS = 60 * 1000;
const CONFIG_TIMEOUT_CAP_MS = 5000;

/** @internal Compare two semver strings (pre-release suffixes ignored). */
export function semverLess(a: string, b: string): boolean {
  const parse = (v: string) => v.split(/[-+]/)[0]!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** The guard state the senders need. */
export interface GuardState {
  /** True when the private-mode guard applies. */
  guard: boolean;
  /** The loaded config, if any. */
  config: ServerSdkConfig | null;
}

/** @internal Loads and caches `GET /v1/server-sdk/config` (single attempt, 10-minute cache, fail closed). */
export class ConfigCache {
  private value: ServerSdkConfig | null = null;
  private fetchedAt = 0;
  private failedAt: number | null = null;
  private inflight: Promise<ServerSdkConfig | null> | null = null;
  private versionWarned = false;

  constructor(
    private readonly requester: Requester,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly timeoutMs: number,
  ) {}

  /** The cached config without fetching (may be stale or null). */
  peek(): ServerSdkConfig | null {
    return this.value;
  }

  /** The config, fetching it when the cache is empty or stale. `null` when unavailable. */
  async get(): Promise<ServerSdkConfig | null> {
    const now = this.clock.now();
    if (this.value && now - this.fetchedAt < CONFIG_TTL_MS) return this.value;
    if (this.failedAt !== null && now - this.failedAt < CONFIG_RETRY_MS) return null;
    if (!this.inflight) {
      this.inflight = this.fetch().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetch(): Promise<ServerSdkConfig | null> {
    try {
      const { data } = await this.requester.request<ServerSdkConfig>({
        method: 'GET',
        path: '/v1/server-sdk/config',
        maxRetries: 0,
        timeout: Math.min(this.timeoutMs, CONFIG_TIMEOUT_CAP_MS),
      });
      if (!data || typeof data !== 'object' || typeof data.private_mode !== 'boolean') throw new Error('unexpected config body');
      this.value = data;
      this.fetchedAt = this.clock.now();
      this.failedAt = null;
      const minimum = data.minimum_sdk_versions?.node;
      if (!this.versionWarned && typeof minimum === 'string' && semverLess(VERSION, minimum)) {
        this.versionWarned = true;
        this.logger.warn(`@clikgate/node ${VERSION} is below the minimum version ${minimum} for your organisation. Please upgrade.`, { code: 'sdk_below_minimum_version' });
      }
      return data;
    } catch (err) {
      this.value = null;
      this.failedAt = this.clock.now();
      const why = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'error';
      this.logger.warn(`Could not load the server SDK config (${why}); the private-mode guard stays on until it loads.`, { code: 'config_unavailable' });
      return null;
    }
  }
}
