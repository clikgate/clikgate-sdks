package com.example.clikgate.webhooks;

import com.clikgate.Webhooks;
import com.clikgate.exception.SignatureVerificationException;
import com.clikgate.model.WebhookEvent;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Receives Clikgate webhooks. No sign-in here: the signature check is what protects the route. With Spring Security,
 * exclude this path from CSRF and permit it (see the README).
 */
@RestController
public class WebhookController {
  private final String webhookSecret;
  private final ProcessedEvents processedEvents;
  private final ReferralEvents referralEvents;

  public WebhookController(@Value("${sample.webhook-secret}") String webhookSecret, ProcessedEvents processedEvents,
      ReferralEvents referralEvents) {
    this.webhookSecret = webhookSecret;
    this.processedEvents = processedEvents;
    this.referralEvents = referralEvents;
  }

  // #region webhook
  @PostMapping("/webhooks/clikgate")
  ResponseEntity<Map<String, String>> receive(@RequestBody byte[] rawBody, // the raw bytes: the signature covers them
      @RequestHeader(name = "Clikgate-Signature", required = false) String signature) {
    WebhookEvent event;
    try {
      event = Webhooks.verify(rawBody, signature, webhookSecret);
    } catch (SignatureVerificationException e) {
      return ResponseEntity.badRequest().body(Map.of("error", e.getCode()));
    }
    if (!processedEvents.markNew(event.getId())) {
      return ResponseEntity.ok(Map.of()); // a repeat delivery: answer 200 and do nothing
    }
    String type = String.valueOf(event.getType());
    if (type.startsWith("referral.")) {
      referralEvents.handleReferralEvent(event);
    }
    return ResponseEntity.ok(Map.of()); // answer quickly; Clikgate waits up to 10 seconds
  }
  // #endregion
}
