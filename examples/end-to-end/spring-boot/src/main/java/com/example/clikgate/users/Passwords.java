package com.example.clikgate.users;

import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/** Salted PBKDF2 password hashes, so even the sample never keeps a plain password. Use your framework's own. */
final class Passwords {
  private static final int ITERATIONS = 210_000;
  private static final SecureRandom RANDOM = new SecureRandom();

  private Passwords() {}

  static String hash(String password) {
    byte[] salt = new byte[16];
    RANDOM.nextBytes(salt);
    return encode(salt) + ":" + encode(derive(password, salt));
  }

  static boolean matches(String password, String stored) {
    String[] parts = stored.split(":");
    byte[] expected = Base64.getDecoder().decode(parts[1]);
    return MessageDigest.isEqual(expected, derive(password, Base64.getDecoder().decode(parts[0])));
  }

  private static byte[] derive(String password, byte[] salt) {
    try {
      PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATIONS, 256);
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException(e);
    }
  }

  private static String encode(byte[] bytes) {
    return Base64.getEncoder().encodeToString(bytes);
  }
}
