package com.clikgate.servlet.jakarta;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.clikgate.Installation;
import java.lang.reflect.Proxy;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

class ClikgateInstallationsTest {
  private static final String APP = "app_01JCK8Z9V7Q4M2N6P8R0S2T4AP";
  private static final String INST = "6a1f0c2e-0000-4000-8000-000000000001";

  private static HttpServletRequest request(List<String> values, boolean boom) {
    return (HttpServletRequest)
        Proxy.newProxyInstance(
            ClikgateInstallationsTest.class.getClassLoader(),
            new Class<?>[] {HttpServletRequest.class},
            (p, m, a) -> {
              if ("getHeaders".equals(m.getName())) {
                if (boom) throw new IllegalStateException("boom");
                return "clikgate-installation".equalsIgnoreCase((String) a[0]) ? Collections.enumeration(values) : Collections.emptyEnumeration();
              }
              throw new UnsupportedOperationException(m.getName());
            });
  }

  @Test
  void readsTheHeader() {
    Installation i = ClikgateInstallations.from(request(Collections.singletonList(" " + APP + ":" + INST + " "), false));
    assertEquals(APP, i.getAppId());
    assertEquals(INST, i.getInstallationId());
  }

  @Test
  void nullWhenMissingInvalidRepeatedOrBroken() {
    assertNull(ClikgateInstallations.from(request(Collections.emptyList(), false)));
    assertNull(ClikgateInstallations.from(request(Collections.singletonList(APP + ":" + INST.toUpperCase()), false)));
    assertNull(ClikgateInstallations.from(request(Collections.singletonList(new String(new char[500]).replace('\0', 'x')), false)));
    assertNull(ClikgateInstallations.from(request(Arrays.asList(APP + ":" + INST, APP + ":" + INST), false)));
    assertNull(ClikgateInstallations.from(request(Collections.emptyList(), true)));
    assertNull(ClikgateInstallations.from(null));
  }
}
