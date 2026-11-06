package com.example.clikgate;

import com.clikgate.ClickContext;
import com.clikgate.Clikgate;
import com.clikgate.Goal;
import com.clikgate.Webhooks;
import com.clikgate.exception.SignatureVerificationException;
import com.clikgate.model.WebhookEvent;
import com.clikgate.servlet.jakarta.ClikgateFilter;
import com.clikgate.spring.ClikgateClickId;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.Collections;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@SpringBootApplication
@RestController
public class ExampleApplication {
  private final Clikgate clikgate; // auto-configured from clikgate.* properties: one client, reused
  private final Map<String, String> clickIds = new ConcurrentHashMap<>(); // your database in real life
  private final Map<String, String> keptBy = new ConcurrentHashMap<>();

  ExampleApplication(Clikgate clikgate) {
    this.clikgate = clikgate;
  }

  public static void main(String[] args) {
    SpringApplication.run(ExampleApplication.class, args);
  }

  // 1 + 2. The starter's filter captured the click ID (?cgid=…, the _cg_cgid cookie, or the header) and persisted a
  // ?cgid=… with the _cg_kept=s marker. POST /cg/keep (clikgate.keep-route.enabled=true) keeps it from pages Spring
  // doesn't render, so Safari keeps it as long as you choose. Save it, with how it was kept
  @PostMapping("/applications")
  Map<String, String> create(@ClikgateClickId String clickId, HttpServletRequest request) {
    String id = "APP-" + (55231 + clickIds.size());
    clickIds.put(id, clickId == null ? "" : clickId);
    ClickContext context = ClikgateFilter.context(clikgate, request); // the User-Agent is read here, never sent
    keptBy.put(id, context.getKeptBy() == null ? "unknown" : context.getKeptBy());
    return Collections.singletonMap("id", id);
  }

  // 3. Later, from any job: send the goal (background, never throws, retried safely)
  @PostMapping("/applications/{id}/approve")
  Map<String, Boolean> approve(@PathVariable String id) {
    String clickId = clickIds.get(id);
    clikgate.goal("account_opened", Goal.builder().clickId(clickId == null || clickId.isEmpty() ? null : clickId).keptBy(keptBy.get(id)).reference(id).value(new BigDecimal("2000000")).currency("NGN").build());
    return Collections.singletonMap("approved", true);
  }

  // 4. Verify Clikgate webhooks over the raw bytes
  @PostMapping("/webhooks/clikgate")
  ResponseEntity<String> webhook(@RequestBody byte[] body, @RequestHeader(name = "Clikgate-Signature", required = false) String signature) {
    try {
      WebhookEvent event = Webhooks.verify(body, signature, System.getenv("CLIKGATE_WEBHOOK_SECRET"));
      if ("goal.completed".equals(event.getType())) {
        System.out.println("goal completed " + event.getId()); // dedupe on the event id
      }
      return ResponseEntity.ok("");
    } catch (SignatureVerificationException e) {
      return ResponseEntity.badRequest().body(e.getCode());
    }
  }
}
