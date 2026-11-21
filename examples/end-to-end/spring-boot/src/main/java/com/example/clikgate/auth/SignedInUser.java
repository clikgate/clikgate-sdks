package com.example.clikgate.auth;

import com.example.clikgate.users.AppUser;
import com.example.clikgate.users.UserStore;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Resolves "Authorization: Bearer &lt;access token&gt;" to the signed-in user. Stands in for your real authentication
 * (Spring Security, for example). Everything Clikgate needs about the user comes from here, never from the request.
 */
@Component
public class SignedInUser {
  private static final String PREFIX = "Bearer ";

  private final UserStore users;

  public SignedInUser(UserStore users) {
    this.users = users;
  }

  public AppUser require(String authorization) {
    if (authorization == null || !authorization.startsWith(PREFIX)) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }
    return users.findBySession(authorization.substring(PREFIX.length()))
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
  }
}
