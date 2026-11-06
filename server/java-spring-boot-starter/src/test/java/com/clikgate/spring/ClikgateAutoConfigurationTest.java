package com.clikgate.spring;

import static org.assertj.core.api.Assertions.assertThat;

import com.clikgate.Clikgate;
import com.clikgate.servlet.jakarta.ClikgateFilter;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class ClikgateAutoConfigurationTest {
  private static final String CID = "clk_01JCK8Z9V7Q4M2N6P8R0S2T4W6";

  @Test
  void createsTheClientFromProperties() {
    new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(ClikgateAutoConfiguration.class))
        .withPropertyValues("clikgate.api-key=cg_test_spring000", "clikgate.private-mode=false", "clikgate.timeout=3s")
        .run(ctx -> {
          assertThat(ctx).hasSingleBean(Clikgate.class);
          assertThat(ctx.getBean(Clikgate.class).mode()).isEqualTo("test");
          assertThat(ctx.getBean(Clikgate.class).payments()).isNotNull(); // change 11: payment confirmations on the bean
          assertThat(ctx.getBean(Clikgate.class).payments().buildFromPaystack("{\"data\":{\"reference\":\"T_1\",\"status\":\"success\",\"amount\":750000,\"currency\":\"NGN\"}}"))
              .containsEntry("amount", "7500").containsEntry("reference", "T_1");
          assertThat(ctx).doesNotHaveBean(FilterRegistrationBean.class); // not a web application
        });
  }

  @Test
  void canBeDisabled() {
    new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(ClikgateAutoConfiguration.class))
        .withPropertyValues("clikgate.enabled=false")
        .run(ctx -> assertThat(ctx).doesNotHaveBean(Clikgate.class));
  }

  @Test
  @SuppressWarnings("unchecked")
  void registersTheFilterInServletApps() throws Exception {
    new WebApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(ClikgateAutoConfiguration.class))
        .withPropertyValues("clikgate.api-key=cg_test_spring000", "clikgate.private-mode=false")
        .run(ctx -> {
          FilterRegistrationBean<ClikgateFilter> reg = ctx.getBean(FilterRegistrationBean.class);
          MockHttpServletRequest req = new MockHttpServletRequest("GET", "/landing");
          req.setQueryString("cgid=" + CID);
          req.setSecure(true);
          MockHttpServletResponse res = new MockHttpServletResponse();
          RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));
          try {
            reg.getFilter().doFilter(req, res, (rq, rs) -> assertThat(ClikgateContext.currentClickId()).isEqualTo(CID));
          } finally {
            RequestContextHolder.resetRequestAttributes();
          }
          // MockHttpServletResponse re-renders Set-Cookie (it adds Expires): check the attributes
          assertThat(res.getHeaders("Set-Cookie")).hasSize(2);
          assertThat(res.getHeaders("Set-Cookie").get(0)).startsWith("_cg_cgid=" + CID + "; Path=/; Max-Age=2592000").contains("SameSite=Lax", "Secure").doesNotContain("HttpOnly");
          assertThat(res.getHeaders("Set-Cookie").get(1)).startsWith("_cg_kept=s; Path=/; Max-Age=2592000").contains("SameSite=Lax", "Secure").doesNotContain("HttpOnly");
          assertThat(ctx).doesNotHaveBean(ClikgateKeepController.class); // off unless clikgate.keep-route.enabled=true
        });
  }

  private static MockHttpServletResponse keep(ClikgateKeepController controller, String method, String body, String... headers) throws Exception {
    MockHttpServletRequest req = new MockHttpServletRequest(method, "/cg/keep");
    req.addHeader("Host", "shop.example.com");
    for (int i = 0; i < headers.length; i += 2) {
      req.addHeader(headers[i], headers[i + 1]);
    }
    req.setContent(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    MockHttpServletResponse res = new MockHttpServletResponse();
    controller.keep(req, res);
    assertThat(res.getHeader("Cache-Control")).isEqualTo("no-store, private");
    assertThat(res.getContentAsString()).isEmpty();
    assertThat(res.getRedirectedUrl()).isNull();
    assertThat(res.getHeader("Location")).isNull();
    return res;
  }

  @Test
  void keepRouteWhenEnabled() {
    new WebApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(ClikgateAutoConfiguration.class))
        .withPropertyValues("clikgate.api-key=cg_test_spring000", "clikgate.private-mode=false", "clikgate.keep-route.enabled=true", "clikgate.cookie.days=90")
        .run(ctx -> {
          ClikgateKeepController controller = ctx.getBean(ClikgateKeepController.class);
          String body = "{\"click_id\":\"" + CID + "\",\"page_click_id\":\"" + CID + "\"}";
          MockHttpServletResponse ok = keep(controller, "POST", body, "Sec-Fetch-Site", "same-origin");
          assertThat(ok.getStatus()).isEqualTo(204);
          assertThat(ok.getHeaders("Set-Cookie")).hasSize(2);
          assertThat(ok.getHeaders("Set-Cookie").get(0)).startsWith("_cg_cgid=" + CID + "; Path=/; Max-Age=7776000").contains("SameSite=Lax", "Secure").doesNotContain("HttpOnly");
          assertThat(ok.getHeaders("Set-Cookie").get(1)).startsWith("_cg_kept=s; Path=/; Max-Age=7776000").contains("Secure");
          assertThat(keep(controller, "POST", body, "Origin", "https://evil.example.net").getStatus()).isEqualTo(403);
          assertThat(keep(controller, "POST", body, "Origin", "https://shop.example.com:8443").getStatus()).isEqualTo(403);
          assertThat(keep(controller, "POST", body, "Origin", "https://shop.example.com").getStatus()).isEqualTo(204);
          MockHttpServletResponse get = keep(controller, "GET", "", "Sec-Fetch-Site", "same-origin");
          assertThat(get.getStatus()).isEqualTo(405);
          assertThat(get.getHeader("Allow")).isEqualTo("POST");
          MockHttpServletResponse bad = keep(controller, "POST", "{\"click_id\":\"<script>\",\"page_click_id\":\"<script>\"}", "Sec-Fetch-Site", "same-origin");
          assertThat(bad.getStatus()).isEqualTo(400);
          assertThat(bad.getHeaders("Set-Cookie")).isEmpty();
        });
  }
}
