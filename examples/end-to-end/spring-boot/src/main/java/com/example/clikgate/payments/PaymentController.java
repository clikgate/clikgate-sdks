package com.example.clikgate.payments;

import com.clikgate.Clikgate;
import com.clikgate.PaymentHelperOptions;
import com.example.clikgate.auth.SignedInUser;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * The app reports the payment as a Payment goal (provider and reference). Your server confirms it here, after its own
 * check with the gateway, so Clikgate counts the confirmed amount, never an amount sent from the app.
 */
@RestController
public class PaymentController {
  private final SignedInUser signedInUser;
  private final PaystackGateway paystack;
  private final Clikgate clikgate;

  public PaymentController(SignedInUser signedInUser, PaystackGateway paystack, Clikgate clikgate) {
    this.signedInUser = signedInUser;
    this.paystack = paystack;
    this.clikgate = clikgate;
  }

  public record PaymentRequest(String reference) {}

  @PostMapping("/payments/paystack/confirm")
  ResponseEntity<Map<String, Object>> confirm(@RequestHeader(name = "Authorization", required = false) String authorization,
      @RequestBody PaymentRequest request) {
    signedInUser.require(authorization);
    // #region from-paystack
    Map<String, Object> verify = paystack.verify(request.reference()); // your own check, with your Paystack key
    if (!(verify.get("data") instanceof Map<?, ?> data) || !"success".equals(data.get("status"))) {
      return ResponseEntity.status(HttpStatus.PAYMENT_REQUIRED).body(Map.of("error", "payment_not_successful"));
    }
    // ...give the customer what they paid for, then pass Paystack's answer on. Only the reference, status, amount,
    // currency, time and cg_click_id are sent: never customer details.
    clikgate.payments().fromPaystack(verify, PaymentHelperOptions.builder().goal("order_paid").build());
    // #endregion
    return ResponseEntity.ok(Map.of("status", "paid", "reference", request.reference()));
  }
}
