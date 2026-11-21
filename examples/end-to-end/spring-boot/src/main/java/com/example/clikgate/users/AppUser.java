package com.example.clikgate.users;

import com.fasterxml.jackson.annotation.JsonIgnore;
import java.time.Instant;

/**
 * A user of your app, as your own database stores it.
 *
 * @param id your own user ID: the same string goes to Clikgate as the customer ID, in the app and on the server
 * @param createdAt when the account was created; Clikgate uses it to tell existing customers from new ones
 */
public record AppUser(String id, String email, @JsonIgnore String passwordHash, Instant createdAt) {}
