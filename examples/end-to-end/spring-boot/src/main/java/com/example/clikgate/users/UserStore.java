package com.example.clikgate.users;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Users and sessions, kept in memory so the sample runs with nothing else installed.
 * In your app this is your database (a users table) and your existing session or token handling.
 */
@Component
public class UserStore {
  private final Map<String, AppUser> usersByEmail = new ConcurrentHashMap<>();
  private final Map<String, AppUser> usersById = new ConcurrentHashMap<>();
  private final Map<String, String> userIdsBySession = new ConcurrentHashMap<>();

  /** Creates the account, or returns empty when the email is taken. */
  public Optional<AppUser> create(String email, String password) {
    AppUser user = new AppUser("user_" + UUID.randomUUID(), email, Passwords.hash(password), Instant.now());
    if (usersByEmail.putIfAbsent(email, user) != null) {
      return Optional.empty();
    }
    usersById.put(user.id(), user);
    return Optional.of(user);
  }

  /** Your own sign-in check: the user when the email and password match. */
  public Optional<AppUser> signIn(String email, String password) {
    return Optional.ofNullable(usersByEmail.get(email))
        .filter(user -> Passwords.matches(password, user.passwordHash()));
  }

  public String startSession(AppUser user) {
    String accessToken = UUID.randomUUID().toString();
    userIdsBySession.put(accessToken, user.id());
    return accessToken;
  }

  public Optional<AppUser> findBySession(String accessToken) {
    return Optional.ofNullable(userIdsBySession.get(accessToken)).map(usersById::get);
  }
}
