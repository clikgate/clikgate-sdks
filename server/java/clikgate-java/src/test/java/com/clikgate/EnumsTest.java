package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.internal.Json;
import com.clikgate.model.GoalEvent;
import com.clikgate.model.GoalKind;
import com.clikgate.model.GoalStatus;
import com.clikgate.model.PaymentConfirmation;
import com.clikgate.model.Provider;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EnumsTest {
  @Test
  void enumWireValues() {
    assertEquals("payment", GoalKind.PAYMENT.getValue());
    assertEquals("standard", GoalKind.STANDARD.toString());
    assertSame(GoalKind.PAYMENT, GoalKind.fromValue("payment"));
    assertNull(GoalKind.fromValue("subscription"));
    assertNull(GoalKind.fromValue(null));
    assertSame(GoalStatus.WAITING, GoalStatus.fromValue("waiting"));
    assertEquals("counted", GoalStatus.COUNTED.getValue());
    assertNull(GoalStatus.fromValue("deferred"));
  }

  @Test
  void providerFromString() {
    assertEquals("mtn_momo", Provider.MTN_MOMO.getValue());
    assertSame(Provider.PAYSTACK, Provider.fromString("paystack"));
    Provider newer = Provider.fromString("acme_pay");
    assertEquals("acme_pay", newer.getValue());
    assertEquals(newer, Provider.fromString("acme_pay"));
    assertNotSame(newer, Provider.fromString("acme_pay"));
    assertFalse(Provider.values().contains(newer));
    assertTrue(Provider.values().contains(Provider.CUSTOM));
  }

  @Test
  @SuppressWarnings("unchecked")
  void goalEventTypedGetters() throws Exception {
    GoalEvent ev = new GoalEvent((Map<String, Object>) Json.parse(
        "{\"status\":\"waiting\",\"reason\":\"waiting_for_confirmation\",\"goal_kind\":\"payment\",\"counted\":false,\"value_ignored\":true,"
            + "\"event_status\":null,\"payment\":{\"confirmation_id\":\"pcf_1\",\"match_status\":\"waiting_for_report\",\"provider\":\"paystack\"}}"));
    assertSame(GoalStatus.WAITING, ev.getStatus());
    assertSame(GoalKind.PAYMENT, ev.getGoalKind());
    assertTrue(ev.isValueIgnored());
    assertNull(ev.getEventStatus());
    assertEquals("pcf_1", ev.getPayment().get("confirmation_id"));

    GoalEvent future = new GoalEvent((Map<String, Object>) Json.parse(
        "{\"status\":\"deferred\",\"goal_kind\":\"subscription\",\"future_field\":1,\"event_status\":\"attributed\"}"));
    assertNull(future.getStatus());
    assertNull(future.getGoalKind());
    assertEquals("deferred", future.get("status"));
    assertEquals(1, ((Number) future.toMap().get("future_field")).intValue());
    assertEquals("attributed", future.getEventStatus());
    assertNull(future.getPayment());
    assertFalse(future.isValueIgnored());

    PaymentConfirmation pc = new PaymentConfirmation(Collections.singletonMap("provider", "acme_pay"));
    assertEquals("acme_pay", pc.getProvider().getValue());
    assertSame(Provider.STRIPE, new PaymentConfirmation(Collections.singletonMap("provider", "stripe")).getProvider());
  }

  @Test
  void goalProviderOption() throws Exception {
    ClientTest.Recorder r = new ClientTest.Recorder();
    List<String> errors = new ArrayList<>();
    Clikgate c = Clikgate.builder().apiKey("cg_test_unit000000000000").transport(r).privateMode(PrivateMode.ON).sendMode(SendMode.SYNC)
        .shutdownHooks(false).onError((e, ctx) -> errors.add(e.getCode())).build();
    c.goals().send("order_paid", Goal.builder().reference("T1").value("7500").provider(Provider.PAYSTACK).build());
    c.goals().send("order_paid", Goal.builder().reference("T2").provider("acme_pay").build());
    List<Object> bodies = r.bodies();
    assertEquals("paystack", ((Map<?, ?>) bodies.get(0)).get("provider"));
    assertEquals("acme_pay", ((Map<?, ?>) bodies.get(1)).get("provider"));

    InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> c.goals().send("order_paid", Goal.builder().reference("T3").provider("PayStack").build()));
    assertEquals("invalid_provider", e.getCode());
    assertEquals("provider", e.getParam());
    assertNull(e.getHttpStatus());
    assertEquals(2, r.requests.size());

    c.goal("order_paid", Goal.builder().reference("T4").provider(Provider.fromString("mtn-momo")).build());
    c.flush();
    assertEquals(Collections.singletonList("invalid_provider"), errors);
    assertEquals(2, r.requests.size());
    c.close();
  }
}
