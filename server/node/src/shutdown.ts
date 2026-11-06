/** @internal One process-wide registry of flush callbacks (SPEC 9.4), so N clients add one listener each. */

type Flusher = { busy(): boolean; flush(timeoutMs: number): Promise<boolean> };

const clients = new Set<Flusher>();
let installed = false;
const SIGNAL_FLUSH_MS = 5000;
const SIGNALS: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

async function flushAll(timeoutMs: number): Promise<void> {
  await Promise.allSettled([...clients].filter((c) => c.busy()).map((c) => c.flush(timeoutMs)));
}

function onBeforeExit(): void {
  if ([...clients].some((c) => c.busy())) void flushAll(SIGNAL_FLUSH_MS);
}

function onSignal(signal: NodeJS.Signals): void {
  void flushAll(SIGNAL_FLUSH_MS).finally(() => {
    uninstall();
    // let other listeners decide; with none left, re-raise so the default exit happens
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  });
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on('beforeExit', onBeforeExit);
  for (const s of SIGNALS) process.on(s, onSignal);
}

function uninstall(): void {
  if (!installed) return;
  installed = false;
  process.off('beforeExit', onBeforeExit);
  for (const s of SIGNALS) process.off(s, onSignal);
}

/** @internal */
export function registerShutdown(f: Flusher): void {
  clients.add(f);
  install();
}

/** @internal */
export function unregisterShutdown(f: Flusher): void {
  clients.delete(f);
  if (clients.size === 0) uninstall();
}
