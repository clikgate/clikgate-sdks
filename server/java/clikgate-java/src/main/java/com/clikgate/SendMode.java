package com.clikgate;

/** How {@code goal()} sends (SPEC 9.3). */
public enum SendMode {
  /** The default: queue and send in batches from a daemon thread. */
  BACKGROUND,
  /** Send each goal at once (still never throws; failures go to {@code onError}). */
  SYNC
}
