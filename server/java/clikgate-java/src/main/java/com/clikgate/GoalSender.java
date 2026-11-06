package com.clikgate;

import com.clikgate.exception.ClikgateException;
import com.clikgate.internal.ApiRequest;
import com.clikgate.internal.Core;
import com.clikgate.internal.ErrorMapper;
import com.clikgate.internal.Requester;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import org.jspecify.annotations.Nullable;

/**
 * The background queue and sender (SPEC 9.3): one daemon thread runs jobs in order (batches and sync-mode sends),
 * so at most one batch is in flight per client and requests leave in queue order.
 */
final class GoalSender {
  private static final int MAX_FAILED_ROUNDS = 3;

  private static final class Queued {
    final Map<String, Object> wire;
    int rounds;

    Queued(Map<String, Object> wire) {
      this.wire = wire;
    }
  }

  private final Core core;
  private final int batchSize;
  private final int maxQueueSize;
  private final Deque<Queued> items = new ArrayDeque<>();
  private final AtomicInteger pending = new AtomicInteger();
  private final ScheduledThreadPoolExecutor worker;
  private volatile @Nullable Thread workerThread;
  private volatile boolean sizeJobPending;

  GoalSender(Core core, int batchSize, int maxQueueSize, Duration flushInterval) {
    this.core = core;
    this.batchSize = batchSize;
    this.maxQueueSize = maxQueueSize;
    this.worker =
        new ScheduledThreadPoolExecutor(
            1,
            r -> {
              Thread t = new Thread(r, "clikgate-sender");
              t.setDaemon(true); // never keeps the JVM alive
              workerThread = t;
              return t;
            });
    this.worker.setRemoveOnCancelPolicy(true);
    long ms = Math.max(1, flushInterval.toMillis());
    this.worker.scheduleWithFixedDelay(
        () -> {
          if (size() > 0) {
            safe(this::drainOnce);
          }
        },
        ms,
        ms,
        TimeUnit.MILLISECONDS);
  }

  synchronized int size() {
    return items.size();
  }

  boolean busy() {
    return size() > 0 || pending.get() > 0;
  }

  private static void safe(Runnable r) {
    try {
      r.run();
    } catch (RuntimeException ignored) {
      // reported inside
    }
  }

  /** Run a job on the worker (in order). Runs it inline on the worker itself or after shutdown. */
  Future<?> post(Runnable job) {
    pending.incrementAndGet();
    Runnable wrapped =
        () -> {
          try {
            safe(job);
          } finally {
            pending.decrementAndGet();
          }
        };
    if (Thread.currentThread() == workerThread) {
      wrapped.run();
      return java.util.concurrent.CompletableFuture.completedFuture(null);
    }
    try {
      return worker.submit(wrapped);
    } catch (RejectedExecutionException e) {
      wrapped.run();
      return java.util.concurrent.CompletableFuture.completedFuture(null);
    }
  }

  void enqueue(Map<String, Object> wire) {
    Queued dropped = null;
    int size;
    synchronized (this) {
      if (items.size() >= maxQueueSize) {
        dropped = items.pollFirst();
      }
      items.addLast(new Queued(wire));
      size = items.size();
    }
    if (dropped != null) {
      core.warn("queue_full_dropped", "The Clikgate queue is full (" + maxQueueSize + " events); the oldest event was dropped.", null);
      core.report(ErrorMapper.local("queue_full", "The background queue was full; this event was dropped.", null), new ErrorContext("goal", Collections.singletonList(shown(dropped.wire)), true));
    }
    if (size >= batchSize && !sizeJobPending) {
      sizeJobPending = true;
      post(this::sizeJob);
    }
  }

  private void sizeJob() {
    sizeJobPending = false;
    while (size() >= batchSize) {
      List<Queued> requeue = sendBatch(take(batchSize));
      requeue(requeue);
      if (!requeue.isEmpty()) {
        break;
      }
    }
  }

  private synchronized List<Queued> take(int n) {
    List<Queued> out = new ArrayList<>();
    while (out.size() < n && !items.isEmpty()) {
      out.add(items.pollFirst());
    }
    return out;
  }

  private synchronized void requeue(List<Queued> batch) {
    for (int i = batch.size() - 1; i >= 0; i--) {
      items.addFirst(batch.get(i));
    }
  }

  /** Attempt every event queued now once; failed retryable ones go back to the front. */
  void drainOnce() {
    int remaining = size();
    List<Queued> requeue = new ArrayList<>();
    while (remaining > 0 && size() > 0) {
      List<Queued> batch = take(Math.min(batchSize, remaining));
      remaining -= batch.size();
      requeue.addAll(sendBatch(batch));
    }
    requeue(requeue);
  }

  private Map<String, String> shown(Map<String, Object> wire) {
    Map<String, String> m = new LinkedHashMap<>();
    m.put("goal", String.valueOf(wire.get("goal")));
    m.put("reference", core.shownReference(wire.get("reference")));
    return m;
  }

  private List<Map<String, String>> shownAll(List<Queued> qs) {
    List<Map<String, String>> out = new ArrayList<>();
    for (Queued q : qs) {
      out.add(shown(q.wire));
    }
    return out;
  }

  private List<Queued> sendBatch(List<Queued> batch) {
    Core.GuardState state;
    try {
      state = core.guardState();
    } catch (RuntimeException e) {
      state = null;
    }
    List<Queued> sendable = new ArrayList<>();
    for (Queued q : batch) {
      try {
        Goals.checkBeforeSend(core, state == null ? guardOn() : state, q.wire);
        sendable.add(q);
      } catch (RuntimeException e) {
        core.report(ErrorMapper.wrap(e), new ErrorContext("goal", Collections.singletonList(shown(q.wire)), true));
      }
    }
    if (sendable.isEmpty()) {
      return Collections.emptyList();
    }
    List<Map<String, Object>> wires = new ArrayList<>();
    for (Queued q : sendable) {
      wires.add(q.wire);
    }
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("events", wires);
    Object data;
    try {
      data = core.requester.request(new ApiRequest("POST", "/v1/goals/events/batch").body(body)).data;
    } catch (RuntimeException e) {
      return failed(ErrorMapper.wrap(e), sendable);
    }
    Object items = data instanceof Map ? ((Map<?, ?>) data).get("data") : null;
    if (items instanceof List) {
      for (Object o : (List<?>) items) {
        if (!(o instanceof Map) || Boolean.TRUE.equals(((Map<?, ?>) o).get("ok"))) {
          continue;
        }
        Map<?, ?> item = (Map<?, ?>) o;
        Object index = item.get("index");
        if (!(index instanceof Number) || ((Number) index).intValue() < 0 || ((Number) index).intValue() >= sendable.size()) {
          continue;
        }
        int status = item.get("status") instanceof Number ? ((Number) item.get("status")).intValue() : 0;
        core.report(ErrorMapper.fromBatchItem(status, item.get("error")), new ErrorContext("goal", Collections.singletonList(shown(sendable.get(((Number) index).intValue()).wire)), true));
      }
    }
    return Collections.emptyList();
  }

  private static Core.GuardState guardOn() {
    return new Core.GuardState(true, null);
  }

  private List<Queued> failed(ClikgateException error, List<Queued> sendable) {
    if (!Requester.isRetryable(error)) {
      core.report(error, new ErrorContext("goals.batch", shownAll(sendable), true));
      return Collections.emptyList();
    }
    List<Queued> keep = new ArrayList<>();
    List<Queued> drop = new ArrayList<>();
    for (Queued q : sendable) {
      q.rounds++;
      (q.rounds >= MAX_FAILED_ROUNDS ? drop : keep).add(q);
    }
    if (!drop.isEmpty()) {
      core.report(error, new ErrorContext("goals.batch", shownAll(drop), true));
    }
    return keep;
  }

  /** Waits until everything queued or in flight now has been attempted. Never throws. */
  boolean flush(Duration timeout) {
    Future<?> f = post(this::drainOnce);
    try {
      f.get(Math.max(0, timeout.toMillis()), TimeUnit.MILLISECONDS);
      return true;
    } catch (TimeoutException e) {
      return false;
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return false;
    } catch (ExecutionException e) {
      return true;
    }
  }

  void stop() {
    worker.shutdown();
  }
}
