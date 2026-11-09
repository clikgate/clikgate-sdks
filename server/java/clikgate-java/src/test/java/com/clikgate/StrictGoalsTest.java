package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import com.clikgate.model.GoalBatchResult;
import com.clikgate.model.GoalStatus;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;

/**
 * "Allow unknown goal names" off: 422 unknown_goal and goal_archived are final (never retried), the SDK never
 * remembers a refusal, and a debug-level line names the goal only.
 */
class StrictGoalsTest {
  private static final String KEY = "cg_test_unit000000000000";
  private static final String LINE = "Goal `level_complete` isn't set up in Clikgate";
  private static final String ENVELOPE =
      "{\"error\":{\"type\":\"invalid_request\",\"code\":\"unknown_goal\",\"message\":\"Not set up.\",\"param\":\"goal\"},"
          + "\"status\":\"refused\",\"reason\":\"unknown_goal\",\"counted\":false,\"goal_kind\":null}";
  private static final String REFUSAL = "{\"status\":\"refused\",\"reason\":\"unknown_goal\",\"counted\":false,\"goal_kind\":null}";
  private static final String BATCH =
      "{\"object\":\"list\",\"data\":[{\"index\":0,\"ok\":true,\"status\":201,\"goal_event\":{\"object\":\"goal_event\",\"status\":\"counted\",\"reason\":null},\"error\":null},"
          + "{\"index\":1,\"ok\":false,\"status\":422,\"goal_event\":null,\"error\":{\"type\":\"invalid_request\",\"code\":\"unknown_goal\",\"message\":\"x\",\"param\":\"goal\"}}]}";

  /** Answers from a script (the last answer repeats). */
  static final class Script implements Transport {
    final List<TransportRequest> requests = new CopyOnWriteArrayList<>();
    final List<Object[]> answers;

    Script(Object[]... answers) {
      this.answers = new ArrayList<>(Arrays.asList(answers));
    }

    @Override
    public synchronized TransportResponse send(TransportRequest request) {
      requests.add(request);
      Object[] a = answers.size() > 1 ? answers.remove(0) : answers.get(0);
      return new TransportResponse((Integer) a[0], Collections.singletonMap("content-type", "application/json"), ((String) a[1]).getBytes(StandardCharsets.UTF_8));
    }
  }

  /** Keeps every line with its level. */
  static final class Lines implements ClikgateLogger {
    final List<String> lines = new CopyOnWriteArrayList<>();
    final boolean debugOn;

    Lines(boolean debugOn) {
      this.debugOn = debugOn;
    }

    @Override
    public void warn(String code, String message) {
      lines.add("warn " + message);
    }

    @Override
    public void error(String code, String message) {
      lines.add("error " + message);
    }

    @Override
    public void debug(String code, String message) {
      if (debugOn) {
        lines.add("debug " + message);
      }
    }

    List<String> debugLines() {
      List<String> out = new ArrayList<>();
      for (String l : lines) {
        if (l.startsWith("debug ")) {
          out.add(l.substring(6));
        }
      }
      return out;
    }
  }

  private static Clikgate.Builder base(Script t, Lines log) {
    return Clikgate.builder().apiKey(KEY).transport(t).privateMode(PrivateMode.OFF).shutdownHooks(false).maxRetries(3).logger(log);
  }

  @Test
  void unknownGoalIsFinalAndLoggedAtDebugWithTheNameOnly() {
    Script t = new Script(new Object[] {422, ENVELOPE});
    Lines log = new Lines(true);
    Clikgate c = base(t, log).sendMode(SendMode.SYNC).build();
    InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> c.goals().send("level_complete", Goal.builder().reference("APP-77120").value("2500").label("Ada").build()));
    assertEquals("unknown_goal", e.getCode());
    assertEquals(Integer.valueOf(422), e.getHttpStatus());
    assertEquals(1, t.requests.size());
    assertEquals(Collections.singletonList(LINE), log.debugLines());
    for (String l : log.lines) {
      assertFalse(l.contains("APP-77120") || l.contains("2500") || l.contains("Ada"), l);
    }
  }

  @Test
  void refusalBodyMapsToItsReason() {
    Script t = new Script(new Object[] {422, REFUSAL}, new Object[] {422, "{\"status\":\"refused\",\"reason\":\"goal_archived\"}"});
    Lines log = new Lines(true);
    Clikgate c = base(t, log).sendMode(SendMode.SYNC).build();
    InvalidRequestException unknown = assertThrows(InvalidRequestException.class, () -> c.goals().send("level_complete", Goal.of("APP-1")));
    assertEquals("unknown_goal", unknown.getCode());
    assertNotNull(unknown.getRaw());
    InvalidRequestException archived = assertThrows(InvalidRequestException.class, () -> c.goals().send("old_signup", Goal.of("APP-2")));
    assertEquals("goal_archived", archived.getCode());
    assertEquals(Integer.valueOf(422), archived.getHttpStatus());
    assertEquals(2, t.requests.size());
    assertEquals(Collections.singletonList(LINE), log.debugLines());
  }

  @Test
  void noLineWithoutDebugLogging() {
    Lines log = new Lines(false);
    Clikgate c = base(new Script(new Object[] {422, ENVELOPE}), log).sendMode(SendMode.SYNC).build();
    assertThrows(InvalidRequestException.class, () -> c.goals().send("level_complete", Goal.of("APP-1")));
    assertTrue(log.lines.isEmpty());
    // a logger written before debug() existed still works (the default does nothing)
    ClikgateLogger old =
        new ClikgateLogger() {
          @Override
          public void warn(String code, String message) {}

          @Override
          public void error(String code, String message) {}
        };
    old.debug("unknown_goal", LINE);
  }

  @Test
  void theNameIsNeverRemembered() {
    Script t = new Script(new Object[] {422, ENVELOPE}, new Object[] {201, "{\"object\":\"goal_event\",\"status\":\"counted\"}"});
    Clikgate c = base(t, new Lines(true)).sendMode(SendMode.SYNC).build();
    assertThrows(InvalidRequestException.class, () -> c.goals().send("level_complete", Goal.of("APP-1")));
    assertEquals(GoalStatus.COUNTED, c.goals().send("level_complete", Goal.of("APP-2")).getStatus());
    assertEquals(2, t.requests.size());
  }

  @Test
  void batchAndBackgroundItems() {
    Script t = new Script(new Object[] {200, BATCH});
    Lines log = new Lines(true);
    GoalBatchResult r =
        base(t, log)
            .sendMode(SendMode.SYNC)
            .build()
            .goals()
            .sendBatch(Arrays.asList(GoalBatchEvent.of("order_paid", Goal.of("R-0")), GoalBatchEvent.of("level_complete", Goal.of("APP-77120"))));
    assertFalse(r.getData().get(1).isOk());
    List<String> errors = new CopyOnWriteArrayList<>();
    Clikgate bg = base(t, log).sendMode(SendMode.BACKGROUND).onError((e, ctx) -> errors.add(e.getCode() + " " + ctx.isDropped())).build();
    bg.goal("order_paid", Goal.of("R-0"));
    bg.goal("level_complete", Goal.builder().reference("APP-77120").value("2500").build());
    assertTrue(bg.flush(Duration.ofSeconds(2)));
    assertTrue(bg.flush(Duration.ofSeconds(2)));
    bg.close(Duration.ofSeconds(1));
    assertEquals(2, t.requests.size());
    assertEquals(Collections.singletonList("unknown_goal true"), errors);
    assertEquals(Arrays.asList(LINE, LINE), log.debugLines());
  }
}
