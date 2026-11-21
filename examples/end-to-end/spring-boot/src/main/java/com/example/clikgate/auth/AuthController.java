package com.example.clikgate.auth;

import com.clikgate.Clikgate;
import com.clikgate.Goal;
import com.clikgate.Installation;
import com.clikgate.spring.ClikgateInstallation;
import com.example.clikgate.identity.ClikgateIdentity;
import com.example.clikgate.users.AppUser;
import com.example.clikgate.users.UserStore;
import java.util.HashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Sign-up, sign-in and "current user": the three responses that tell the app who is signed in. */
@RestController
public class AuthController {
  private final UserStore users;
  private final SignedInUser signedInUser;
  private final ClikgateIdentity identity;
  private final Clikgate clikgate;

  public AuthController(UserStore users, SignedInUser signedInUser, ClikgateIdentity identity, Clikgate clikgate) {
    this.users = users;
    this.signedInUser = signedInUser;
    this.identity = identity;
    this.clikgate = clikgate;
  }

  public record Credentials(String email, String password) {}

  @PostMapping("/auth/sign-up")
  ResponseEntity<Map<String, Object>> signUp(@RequestBody Credentials credentials,
      @ClikgateInstallation Installation installation) {
    AppUser user = users.create(credentials.email(), credentials.password()).orElse(null);
    if (user == null) {
      return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "email_taken"));
    }
    identity.identifyInstallation(user, installation);
    // #region server-goal
    // A goal only your server knows about. goal() never throws: it is queued and sent in the background, and the
    // reference (your own ID for the event) makes a resend count once.
    clikgate.goal("account_opened", Goal.builder().reference(user.id()).build());
    // #endregion
    return ResponseEntity.status(HttpStatus.CREATED).body(session(user));
  }

  @PostMapping("/auth/sign-in")
  ResponseEntity<Map<String, Object>> signIn(@RequestBody Credentials credentials,
      @ClikgateInstallation Installation installation) {
    AppUser user = users.signIn(credentials.email(), credentials.password()).orElse(null);
    if (user == null) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "invalid_credentials"));
    }
    identity.identifyInstallation(user, installation); // only after your own sign-in check succeeded
    return ResponseEntity.ok(session(user));
  }

  /** The app calls this at every open, so it gets a fresh token and Path B runs again within Clikgate's 7 days. */
  @GetMapping("/me")
  Map<String, Object> me(@RequestHeader(name = "Authorization", required = false) String authorization,
      @ClikgateInstallation Installation installation) {
    AppUser user = signedInUser.require(authorization);
    identity.identifyInstallation(user, installation);
    return withIdentityToken(user, new HashMap<>());
  }

  private Map<String, Object> session(AppUser user) {
    Map<String, Object> body = new HashMap<>();
    body.put("accessToken", users.startSession(user));
    return withIdentityToken(user, body);
  }

  private Map<String, Object> withIdentityToken(AppUser user, Map<String, Object> body) {
    body.put("user", user);
    body.put("clikgateIdentityToken", identity.identityToken(user)); // null without an identity secret
    return body;
  }
}
