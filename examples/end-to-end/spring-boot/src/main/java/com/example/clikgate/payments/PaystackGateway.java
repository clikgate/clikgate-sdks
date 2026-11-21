package com.example.clikgate.payments;

import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Your server's own check with Paystack. Stubbed in the sample: it answers like a successful
 * {@code GET https://api.paystack.co/transaction/verify/{reference}} for ₦7,500, so the sample runs without a Paystack
 * account. In your app, make that request with your Paystack secret key and return the parsed JSON body.
 */
@Component
public class PaystackGateway {

  public Map<String, Object> verify(String reference) {
    return Map.of(
        "status", true,
        "message", "Verification successful",
        "data", Map.of(
            "status", "success",
            "reference", reference,
            "amount", 750000, // kobo: Paystack's minor unit
            "currency", "NGN",
            "paid_at", "2026-11-20T10:15:00.000Z",
            "metadata", Map.of()));
  }
}
