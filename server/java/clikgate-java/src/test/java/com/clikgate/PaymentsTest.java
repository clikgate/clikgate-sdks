package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.PrivateModeFieldRejectedException;
import com.clikgate.internal.PaymentExtract;
import com.clikgate.model.PaymentConfirmation;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class PaymentsTest {
  private static final String KEY = "cg_test_unit000000000000";
  private static final String CLICK = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";
  private static final String CONFIRMATION = "{\"object\":\"payment_confirmation\",\"id\":\"pcf_1\",\"status\":\"success\",\"amount\":\"7500\",\"amount_minor\":750000,\"match_status\":\"matched\",\"duplicate\":false}";

  private static Clikgate client(ClientTest.Recorder r, PrivateMode pm, List<String> warnings) {
    r.status = 200;
    r.body = CONFIRMATION;
    return Clikgate.builder()
        .apiKey(KEY)
        .transport(r)
        .privateMode(pm)
        .shutdownHooks(false)
        .logger(
            new ClikgateLogger() {
              @Override
              public void warn(String code, String message) {
                warnings.add(code);
              }

              @Override
              public void error(String code, String message) {}
            })
        .build();
  }

  private static Map<String, Object> paystack(Object amount, String currency) {
    Map<String, Object> data = new LinkedHashMap<>();
    data.put("reference", "T_1");
    data.put("status", "success");
    data.put("amount", amount);
    data.put("currency", currency);
    return Collections.singletonMap("data", data);
  }

  @Test
  void confirmSendsTheWireBodyAndReturnsTheConfirmation() throws Exception {
    ClientTest.Recorder r = new ClientTest.Recorder();
    Clikgate c = client(r, PrivateMode.OFF, new ArrayList<>());
    PaymentConfirmation pc = c.payments().confirm(PaymentConfirmParams.builder().provider("paystack").reference("T_ref_001").status("success")
        .amount(new BigDecimal("7500.00")).currency("NGN").aliases(Arrays.asList("A_1")).clickId(CLICK).test(true).build());
    assertEquals("pcf_1", pc.getId());
    assertEquals(Long.valueOf(750000L), pc.getAmountMinor());
    assertEquals(new BigDecimal("7500"), pc.getAmount());
    assertEquals("matched", pc.getMatchStatus());
    assertFalse(pc.isDuplicate());
    assertEquals("/v1/payments/confirmations", r.requests.get(0).getUrl().replaceAll("^https?://[^/]+", ""));
    @SuppressWarnings("unchecked")
    Map<String, Object> body = (Map<String, Object>) r.bodies().get(0);
    assertEquals("7500.00", body.get("amount"));
    assertEquals(Arrays.asList("A_1"), body.get("aliases"));
    assertEquals(Boolean.TRUE, body.get("test"));
    assertFalse(body.containsKey("goal"));
  }

  @Test
  void localValidationSendsNothing() {
    ClientTest.Recorder r = new ClientTest.Recorder();
    Clikgate c = client(r, PrivateMode.OFF, new ArrayList<>());
    InvalidRequestException e = assertThrows(InvalidRequestException.class,
        () -> c.payments().confirm(PaymentConfirmParams.builder().provider("paystack").reference("T").status("success").amount("50").amountMinor(5000L).build()));
    assertEquals("amount_and_amount_minor", e.getCode());
    assertEquals("invalid_status", assertThrows(InvalidRequestException.class,
        () -> c.payments().confirm(PaymentConfirmParams.builder().provider("paystack").reference("T").status("paid").build())).getCode());
    assertEquals("invalid_amount", assertThrows(InvalidRequestException.class,
        () -> c.payments().confirm(PaymentConfirmParams.builder().provider("paystack").reference("T").status("success").amount("1e3").build())).getCode());
    assertEquals("invalid_provider", assertThrows(InvalidRequestException.class,
        () -> c.payments().confirm(PaymentConfirmParams.builder().provider("Stripe").reference("T").status("success").build())).getCode());
    assertTrue(r.requests.isEmpty());
  }

  @Test
  void privateModeGuardRefusesExtraFieldsBeforeTheTransport() {
    ClientTest.Recorder r = new ClientTest.Recorder();
    Clikgate c = client(r, PrivateMode.ON, new ArrayList<>());
    PrivateModeFieldRejectedException e = assertThrows(PrivateModeFieldRejectedException.class,
        () -> c.payments().confirm(PaymentConfirmParams.builder().provider("paystack").reference("T").status("success").extra("email", "ada@example.com").build()));
    assertEquals("email", e.getField());
    assertFalse(e.getMessage().contains("ada@example.com"));
    assertTrue(r.requests.isEmpty());
    // The helper body is all allow-listed.
    c.payments().fromPaystack(paystack(750000, "NGN"));
    assertEquals(1, r.requests.size());
  }

  @Test
  void amountsAreExactForEveryInputType() {
    Payments p = Clikgate.builder().apiKey(KEY).shutdownHooks(false).build().payments();
    assertEquals("7500", p.buildFromPaystack(paystack(750000, "NGN")).get("amount"));
    assertEquals("50", p.buildFromPaystack(paystack("5000", "NGN")).get("amount"));
    assertEquals("100.5", p.buildFromPaystack(paystack(10050L, "GHS")).get("amount"));
    assertEquals("0", p.buildFromPaystack(paystack(new BigDecimal("0.00"), "NGN")).get("amount"));
    Map<String, Object> fw = new LinkedHashMap<>();
    fw.put("tx_ref", "F_1");
    fw.put("status", "successful");
    fw.put("amount", 1500.25d); // a double: through its shortest text, never new BigDecimal(double)
    fw.put("currency", "NGN");
    assertEquals("1500.25", p.buildFromFlutterwave(fw).get("amount"));
    fw.put("amount", 0.1f);
    assertEquals("0.1", p.buildFromFlutterwave(fw).get("amount"));
    fw.put("amount", "10.70");
    assertEquals("10.7", p.buildFromFlutterwave(fw).get("amount"));
    fw.put("amount", -5);
    assertFalse(p.buildFromFlutterwave(fw).containsKey("amount"));
    // JSON text and Jackson trees keep floats exact too.
    assertEquals("1500.25", p.buildFromFlutterwave("{\"data\":{\"tx_ref\":\"F\",\"status\":\"successful\",\"amount\":1500.25,\"currency\":\"NGN\"}}").get("amount"));
    ObjectNode node = new ObjectMapper().createObjectNode();
    node.putObject("data").put("tx_ref", "F").put("status", "successful").put("amount", 1500.25d).put("currency", "ngn").put("id", 1163068L);
    Map<String, Object> b = p.buildFromFlutterwave(node);
    assertEquals("1500.25", b.get("amount"));
    assertEquals("NGN", b.get("currency"));
    assertEquals(Arrays.asList("1163068"), b.get("aliases"));
    assertEquals("12345678901234567890.01", PaymentExtract.amountString(new BigDecimal("12345678901234567890.0100")));
    assertEquals("100", PaymentExtract.amountString(new BigDecimal("1E+2")));
  }

  @Test
  void stripeZeroDecimalAndTimes() {
    Payments p = Clikgate.builder().apiKey(KEY).shutdownHooks(false).build().payments();
    Map<String, Object> pi = new LinkedHashMap<>();
    pi.put("id", "pi_1");
    pi.put("object", "payment_intent");
    pi.put("status", "succeeded");
    pi.put("amount_received", 500);
    pi.put("currency", "jpy");
    pi.put("created", 1793016000L);
    pi.put("livemode", true);
    Map<String, Object> b = p.buildFromStripe(pi);
    assertEquals("500", b.get("amount"));
    assertEquals("JPY", b.get("currency"));
    assertEquals("2026-10-26T12:00:00Z", b.get("occurred_at"));
    assertEquals(Boolean.FALSE, b.get("test"));
    pi.put("created", 1793016000250L); // milliseconds
    assertEquals("2026-10-26T12:00:00.250Z", p.buildFromStripe(pi).get("occurred_at"));
    pi.put("object", "charge");
    assertNull(p.buildFromStripe(pi));
  }

  @Test
  void unrecognisedResponsesWarnAndSendNothing() {
    ClientTest.Recorder r = new ClientTest.Recorder();
    List<String> warnings = new ArrayList<>();
    Clikgate c = client(r, PrivateMode.OFF, warnings);
    assertNull(c.payments().fromMonnify("not json"));
    assertNull(c.payments().fromPaystack(Collections.singletonMap("status", false)));
    Map<String, Object> session = new LinkedHashMap<>();
    session.put("id", "cs_1");
    session.put("object", "checkout.session");
    session.put("payment_status", "no_payment_required");
    assertNull(c.payments().fromStripe(session));
    assertEquals(Arrays.asList("unrecognised_payment_response", "unrecognised_payment_response"), warnings);
    assertTrue(r.requests.isEmpty());
  }
}
