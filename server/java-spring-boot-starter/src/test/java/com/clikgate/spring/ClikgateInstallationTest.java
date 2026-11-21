package com.clikgate.spring;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.clikgate.Installation;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;

class ClikgateInstallationTest {
  private static final String APP = "app_01JCK8Z9V7Q4M2N6P8R0S2T4AP";
  private static final String INST = "6a1f0c2e-0000-4000-8000-000000000001";

  @RestController
  static class MeController {
    @GetMapping("/me")
    String me(@ClikgateInstallation Installation installation) {
      return installation == null ? "none" : installation.getAppId() + "|" + installation.getInstallationId();
    }
  }

  private static MockMvc mvc() {
    List<HandlerMethodArgumentResolver> resolvers = new ArrayList<>();
    new ClikgateAutoConfiguration.MvcConfiguration().addArgumentResolvers(resolvers);
    return MockMvcBuilders.standaloneSetup(new MeController()).setCustomArgumentResolvers(resolvers.toArray(new HandlerMethodArgumentResolver[0])).build();
  }

  @Test
  void theMvcConfigurationRegistersTheResolver() {
    List<HandlerMethodArgumentResolver> resolvers = new ArrayList<>();
    new ClikgateAutoConfiguration.MvcConfiguration().addArgumentResolvers(resolvers);
    assertThat(resolvers).hasAtLeastOneElementOfType(ClikgateAutoConfiguration.InstallationArgumentResolver.class);
  }

  @Test
  void resolvesTheHeader() throws Exception {
    mvc().perform(get("/me").header("Clikgate-Installation", APP + ":" + INST)).andExpect(status().isOk()).andExpect(content().string(APP + "|" + INST));
  }

  @Test
  void nullAndNeverAnErrorWhenMissingInvalidOversizedOrRepeated() throws Exception {
    MockMvc mvc = mvc();
    mvc.perform(get("/me")).andExpect(status().isOk()).andExpect(content().string("none"));
    mvc.perform(get("/me").header("Clikgate-Installation", APP + ":" + INST.toUpperCase())).andExpect(status().isOk()).andExpect(content().string("none"));
    mvc.perform(get("/me").header("Clikgate-Installation", new String(new char[5000]).replace('\0', 'x'))).andExpect(status().isOk()).andExpect(content().string("none"));
    mvc.perform(get("/me").header("Clikgate-Installation", APP + ":" + INST, APP + ":" + INST)).andExpect(status().isOk()).andExpect(content().string("none"));
  }
}
