package com.clikgate.http;

import java.time.Duration;

/**
 * Clock and sleep, replaceable for tests (SPEC section 18): {@code Clikgate.builder().clock(...)}.
 *
 * <pre>{@code
 * Clock fake = new Clock() {
 *   public long nowMillis() { return 1_793_016_000_000L; }
 *   public void sleep(Duration d) { sleeps.add(d.toMillis()); }
 * };
 * }</pre>
 */
public interface Clock {
  /** Milliseconds since the epoch. */
  long nowMillis();

  /** Wait (the retry delay). */
  void sleep(Duration duration) throws InterruptedException;

  /** The system clock. */
  Clock SYSTEM =
      new Clock() {
        @Override
        public long nowMillis() {
          return System.currentTimeMillis();
        }

        @Override
        public void sleep(Duration duration) throws InterruptedException {
          long ms = duration.toMillis();
          if (ms > 0) {
            Thread.sleep(ms);
          }
        }
      };
}
