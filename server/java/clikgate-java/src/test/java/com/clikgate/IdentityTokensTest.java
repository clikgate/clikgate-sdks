package com.clikgate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.clikgate.exception.ClikgateException;
import com.clikgate.exception.ClikgateServerOnlyException;
import com.clikgate.exception.ConfigurationException;
import com.clikgate.exception.InvalidRequestException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

/** Change 22 I.1 / R.27: identity tokens against the shared vectors made by the backend signer. */
class IdentityTokensTest {
  private static final JsonNode DOC = load();

  private static JsonNode load() {
    try {
      return new ObjectMapper().readTree(new File("../../conformance/vectors/identity-token-vectors.json"));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  private static JsonNode vector(String name) {
    for (JsonNode v : DOC.get("vectors")) {
      if (v.get("name").asText().equals(name)) return v;
    }
    throw new IllegalStateException("no vector " + name);
  }

  private static Function<String, String> env(Map<String, String> values) {
    return values::get;
  }

  @Test
  void matchesTheSharedVectors() {
    int n = 0;
    for (JsonNode v : DOC.get("vectors")) {
      assertEquals(v.get("token").asText(), IdentityTokens.create(v.get("customer_id").asText(), v.get("secret").asText(), v.get("issued_at").asLong()), v.get("name").asText());
      n++;
    }
    assertTrue(n >= 10);
  }

  @Test
  void secretFromTheEnvironmentAndThePerAppMap() {
    JsonNode a = vector("ascii");
    JsonNode other = vector("other_app_secret");
    long at = a.get("issued_at").asLong();
    Map<String, String> single = new HashMap<>();
    single.put(IdentityTokens.SECRET_ENV, a.get("secret").asText());
    assertEquals(a.get("token").asText(), IdentityTokens.createWith(false, null, null, env(single), "user_42", null, null, at));
    assertEquals(a.get("token").asText(), IdentityTokens.createWith(false, null, null, env(single), "user_42", "app_unknown", null, at));
    Map<String, String> map = new HashMap<>();
    map.put(IdentityTokens.SECRETS_ENV, "{\"app_shop\":\"" + a.get("secret").asText() + "\",\"app_rider\":\"" + other.get("secret").asText() + "\"}");
    assertEquals(other.get("token").asText(), IdentityTokens.createWith(false, null, null, env(map), "user_42", "app_rider", null, at));
    assertEquals(a.get("token").asText(), IdentityTokens.createWith(false, null, null, env(map), "user_42", "app_shop", null, at));
    ConfigurationException e = assertThrows(ConfigurationException.class, () -> IdentityTokens.createWith(false, null, null, env(map), "user_42", null, null, at));
    assertEquals("missing_identity_secret", e.getCode());
    assertEquals("appId", e.getParam());
  }

  @Test
  void missingAndMalformedSecrets() {
    ConfigurationException missing = assertThrows(ConfigurationException.class, () -> IdentityTokens.createWith(false, null, null, env(new HashMap<>()), "user_42", null, null, 1L));
    assertEquals("missing_identity_secret", missing.getCode());
    Map<String, String> bad = new HashMap<>();
    bad.put(IdentityTokens.SECRETS_ENV, "{not json");
    ConfigurationException malformed = assertThrows(ConfigurationException.class, () -> IdentityTokens.createWith(false, null, null, env(bad), "user_42", "app_shop", null, 1L));
    assertEquals("invalid_identity_secrets", malformed.getCode());
    assertFalse(malformed.getMessage().contains("not json"));
  }

  @Test
  void clientMethodUsesTheBuilderSecrets() {
    JsonNode a = vector("ascii");
    JsonNode other = vector("other_app_secret");
    Map<String, String> secrets = new LinkedHashMap<>();
    secrets.put("app_rider", other.get("secret").asText());
    Clikgate c = Clikgate.builder().apiKey("cg_test_unit000000000000").shutdownHooks(false).identitySecret(a.get("secret").asText()).identitySecrets(secrets).build();
    try {
      String token = c.createIdentityToken("user_42");
      String expected = IdentityTokens.create("user_42", a.get("secret").asText(), Long.parseLong(token.substring(token.lastIndexOf('.') + 1)));
      assertEquals(expected, token);
      String riderToken = c.createIdentityToken("user_42", "app_rider");
      assertEquals(IdentityTokens.create("user_42", other.get("secret").asText(), Long.parseLong(riderToken.substring(riderToken.lastIndexOf('.') + 1))), riderToken);
    } finally {
      c.close();
    }
  }

  @Test
  void issuedAtDefaultsToNow() {
    long before = System.currentTimeMillis() / 1000L;
    String token = IdentityTokens.createWith(false, "cgis_unit", null, env(new HashMap<>()), "user_42", null, null, null);
    String[] parts = token.split("\\.");
    assertEquals(2, parts.length);
    long issued = Long.parseLong(parts[1]);
    assertTrue(issued >= before && issued <= before + 2);
    assertTrue(parts[0].matches("[A-Za-z0-9_-]{43}"));
  }

  @Test
  void invalidCustomerIdsAreRefusedWithoutEcho() {
    for (JsonNode bad : DOC.get("invalid_customer_ids")) {
      String id = bad.get("customer_id").asText();
      InvalidRequestException e = assertThrows(InvalidRequestException.class, () -> IdentityTokens.create(id, "cgis_unit", 1L), bad.get("name").asText());
      assertEquals("invalid_customer_id", e.getCode());
      if (!id.isEmpty()) assertFalse(e.getMessage().contains(id));
    }
    assertThrows(InvalidRequestException.class, () -> IdentityTokens.createWith(false, "cgis_unit", null, env(new HashMap<>()), null, null, null, 1L));
    assertThrows(InvalidRequestException.class, () -> IdentityTokens.create("user_42", "cgis_unit", -1L));
  }

  @Test
  void refusesAndroid() {
    assertFalse(IdentityTokens.onAndroid(), "android.os.Build doesn't load on a JVM server");
    assertFalse(IdentityTokens.classPresent(IdentityTokens.ANDROID_MARKER));
    assertTrue(IdentityTokens.classPresent("java.lang.Object"));
    ClikgateServerOnlyException e = assertThrows(ClikgateServerOnlyException.class, () -> IdentityTokens.createWith(true, "cgis_unit", null, env(new HashMap<>()), "user_42", null, null, 1L));
    assertTrue(e instanceof ClikgateException);
    assertEquals("server_only", e.getCode());
    assertFalse(e.getMessage().contains("cgis_unit"));
  }
}
