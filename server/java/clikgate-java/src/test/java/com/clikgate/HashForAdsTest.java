package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.clikgate.exception.InvalidRequestException;
import com.clikgate.exception.PrivateModeFieldRejectedException;
import com.clikgate.http.Transport;
import com.clikgate.http.TransportRequest;
import com.clikgate.http.TransportResponse;
import com.clikgate.internal.Json;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.Test;

/** SPEC 25: hashed email and phone for ad network matching (the website's vectors). */
class HashForAdsTest {
  private static final String KEY = "cg_test_unit000000000000";
  private static final String H_EMAIL = "0f096d5de5ccb3a1e50f34246aab7d9c539de7bd63498d5fae420ecfba31aaed";
  private static final String H_E164 = "6b39248188406864f30420963a3e793bf8571e2fa733f767889f9fa882b5d14c";
  private static final String H_DIGITS = "fe144b034b54f22ea55473f479fe83b2ccbc55af8cdb280ef65ef280bcd4bf17";
  private static final String CLICK = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";

  static final class Recorder implements Transport {
    final List<TransportRequest> requests = new CopyOnWriteArrayList<>();
    volatile String body = "{\"object\":\"goal_event\",\"status\":\"counted\"}";

    @Override
    public TransportResponse send(TransportRequest request) {
      requests.add(request);
      return new TransportResponse(201, Collections.singletonMap("content-type", "application/json"), body.getBytes(StandardCharsets.UTF_8));
    }

    Object body(int i) throws Exception {
      return Json.parse(requests.get(i).getBody());
    }
  }

  private static Clikgate client(Recorder r, PrivateMode pm) {
    return Clikgate.builder().apiKey(KEY).transport(r).privateMode(pm).sendMode(SendMode.SYNC).shutdownHooks(false).build();
  }

  @Test
  void theDocumentedVectors() {
    HashedIdentifiers h = HashForAds.hash("  Ada.Obi@Example.com ", "+234 803 123 4567");
    assertEquals(H_EMAIL, h.getHashedEmail());
    assertEquals(H_E164, h.getHashedPhoneE164());
    assertEquals(H_DIGITS, h.getHashedPhoneDigits());
    for (String phone : new String[] {"00234 (803) 123-4567", "\t+2348031234567\n"}) {
      HashedIdentifiers p = HashForAds.hash(null, phone);
      assertNull(p.getHashedEmail());
      assertEquals(H_E164, p.getHashedPhoneE164());
      assertEquals(H_DIGITS, p.getHashedPhoneDigits());
    }
    HashedIdentifiers e = HashForAds.hash("ADA.OBI@EXAMPLE.COM", null);
    assertEquals(H_EMAIL, e.getHashedEmail());
    assertNull(e.getHashedPhoneE164());
    assertNull(e.getHashedPhoneDigits());
    HashedIdentifiers none = HashForAds.hash(null, null);
    assertNull(none.getHashedEmail());
    assertNull(none.getHashedPhoneE164());
    assertFalse(h.toString().contains(H_EMAIL));
  }

  @Test
  void refusedInputsAreNeverEchoed() {
    String[][] cases = {
      {"phone", "0803 123 4567"},
      {"phone", "2348031234567"},
      {"phone", "+12345"},
      {"phone", "+0803 123 4567"},
      {"phone", "+1234567890123456"},
      {"phone", ""},
      {"email", "ada.obi.example.com"},
      {"email", "   "},
    };
    for (String[] c : cases) {
      String field = c[0];
      String input = c[1];
      InvalidRequestException e =
          assertThrows(InvalidRequestException.class, () -> HashForAds.hash("email".equals(field) ? input : null, "phone".equals(field) ? input : null), field + " " + input);
      assertEquals("invalid_argument", e.getCode());
      assertEquals(field, e.getParam());
      assertNull(e.getHttpStatus());
      if (!input.trim().isEmpty()) {
        assertFalse(e.getMessage().contains(input.trim()), input);
      }
    }
  }

  @Test
  void goalsCarryTheHashedOptionsAndAMalformedHashIsRefusedLocally() throws Exception {
    Recorder r = new Recorder();
    Clikgate c = client(r, PrivateMode.OFF);
    c.goals().send("account_opened", Goal.builder().reference("APP-1").clickId(CLICK).hashed(HashForAds.hash("ada.obi@example.com", "+2348031234567")).build());
    Map<String, Object> expected = new LinkedHashMap<>();
    expected.put("goal", "account_opened");
    expected.put("reference", "APP-1");
    expected.put("click_id", CLICK);
    expected.put("hashed_email", H_EMAIL);
    expected.put("hashed_phone_e164", H_E164);
    expected.put("hashed_phone_digits", H_DIGITS);
    assertEquals(expected, r.body(0));

    List<Object[]> bad = new ArrayList<>();
    bad.add(new Object[] {Goal.builder().reference("APP-2").hashedEmail(H_EMAIL.toUpperCase(java.util.Locale.ROOT)).build(), "hashed_email", H_EMAIL.toUpperCase(java.util.Locale.ROOT)});
    bad.add(new Object[] {Goal.builder().reference("APP-2").hashedPhoneE164("+2348031234567").build(), "hashed_phone_e164", "+2348031234567"});
    bad.add(new Object[] {Goal.builder().reference("APP-2").hashedPhoneDigits(H_DIGITS.substring(1)).build(), "hashed_phone_digits", H_DIGITS.substring(1)});
    for (Object[] b : bad) {
      InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> c.goals().send("account_opened", (Goal) b[0]));
      assertEquals("invalid_hashed_identifier", e.getCode());
      assertEquals(b[1], e.getParam());
      assertFalse(e.getMessage().contains((String) b[2]));
    }
    InvalidRequestException batch =
        assertThrows(InvalidRequestException.class, () -> c.goals().sendBatch(java.util.Arrays.asList(
            GoalBatchEvent.of("account_opened", Goal.of("APP-1")),
            GoalBatchEvent.of("account_opened", Goal.builder().reference("APP-2").hashedPhoneDigits("abc").build()))));
    assertEquals("invalid_hashed_identifier", batch.getCode());
    assertEquals(Integer.valueOf(1), batch.getIndex());
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("external_id", "ORD-1");
    p.put("hashed_email", "ada@example.com");
    InvalidRequestException conv = assertThrows(InvalidRequestException.class, () -> c.conversions().create(p));
    assertEquals("invalid_hashed_identifier", conv.getCode());
    assertEquals("hashed_email", conv.getParam());
    assertEquals(1, r.requests.size());
    c.close();
  }

  @Test
  void privateModeAllowsTheHashedFieldsNotRawCustomerDetails() throws Exception {
    Recorder r = new Recorder();
    Clikgate c = client(r, PrivateMode.ON);
    c.goals().send("account_opened", Goal.builder().reference("APP-1").hashedEmail(H_EMAIL).build());
    r.body = "{\"object\":\"conversion\",\"id\":\"cnv_1\"}";
    Map<String, Object> p = new LinkedHashMap<>();
    p.put("external_id", "ORD-1");
    p.put("goal", "order_paid");
    p.put("hashed_phone_e164", H_E164);
    p.put("hashed_phone_digits", H_DIGITS);
    c.conversions().create(p);
    Map<String, Object> raw = new LinkedHashMap<>();
    raw.put("external_id", "ORD-2");
    raw.put("customer", Collections.singletonMap("email", "ada@example.com"));
    assertThrows(PrivateModeFieldRejectedException.class, () -> c.conversions().create(raw));
    assertEquals(2, r.requests.size());
    assertEquals(H_DIGITS, ((Map<?, ?>) r.body(1)).get("hashed_phone_digits"));
    c.close();
  }
}
