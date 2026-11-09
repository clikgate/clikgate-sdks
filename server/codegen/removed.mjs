// Change 22 (D1, G.3, R.2, R.9): routes and values the backend is removing or adding while the server SDKs are
// regenerated. The generator applies this to the vendored public document before filtering, so the SDKs drop the old
// app-event routes now, whatever backend checkout was last synced. Once the backend's own openapi-public.json no longer
// has them (and GoalStatus has `received`), this is a no-op; it stays as a guard so they can't come back unnoticed.
//
// The CI guard (scripts/check_no_track.mjs) allows this file by name: it is the one place the removed routes are named.

/** Paths removed in change 22: app events (`/v1/sdk/events`, `/v1/app-events`), the server event intake and Event rules. */
export const REMOVED_PATHS = [
  /^\/v1\/sdk\/events$/,
  /^\/v1\/app-events(\/.*)?$/,
  /^\/v1\/apps\/\{[^}]+\}\/events$/,
  /^\/v1\/apps\/\{[^}]+\}\/event-rules(\/.*)?$/,
];

/** GoalStatus values change 22 adds (R.9: `received` = stored, not counted). */
export const ADDED_GOAL_STATUSES = ['received'];

/**
 * A copy of `spec` with the change 22 removals applied. `notes` says what changed (counts only, so generated files
 * never name the removed routes).
 */
export function applyChange22(spec) {
  const out = { ...spec, paths: {} };
  let removed = 0;
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (REMOVED_PATHS.some((re) => re.test(path))) {
      removed += Object.keys(item ?? {}).filter((k) => !k.startsWith('x-') && k !== 'parameters').length;
      continue;
    }
    out.paths[path] = item;
  }
  const notes = [];
  if (removed) notes.push(`${removed} app-event operations removed (change 22 D1, R.2)`);
  const status = spec.components?.schemas?.GoalStatus;
  if (status && Array.isArray(status.enum)) {
    const missing = ADDED_GOAL_STATUSES.filter((v) => !status.enum.includes(v));
    if (missing.length) {
      out.components = { ...spec.components, schemas: { ...spec.components.schemas, GoalStatus: { ...status, enum: [...status.enum, ...missing] } } };
      notes.push(`GoalStatus gains ${missing.join(', ')} (change 22 R.9)`);
    }
  }
  return { spec: out, notes };
}
