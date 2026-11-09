package com.clikgate.spring;

import com.clikgate.ClickIds;
import com.clikgate.Clikgate;
import com.clikgate.OnError;
import com.clikgate.PrivateMode;
import com.clikgate.SendMode;
import com.clikgate.servlet.jakarta.ClikgateFilter;
import java.util.List;
import java.util.Locale;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.MethodParameter;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Auto-configures a {@link Clikgate} bean from {@code clikgate.*} properties (closed, and flushed, with the
 * application context), the click-ID servlet filter, {@link ClikgateClickId} parameters and, when
 * {@code clikgate.keep-route.enabled=true}, the {@code /cg/keep} route ({@link ClikgateKeepController}).
 */
@AutoConfiguration
@EnableConfigurationProperties(ClikgateProperties.class)
@ConditionalOnProperty(prefix = "clikgate", name = "enabled", havingValue = "true", matchIfMissing = true)
public class ClikgateAutoConfiguration {

  /** The one client (create one and reuse it). Spring closes it on shutdown, which flushes queued goals. */
  @Bean(destroyMethod = "close")
  @ConditionalOnMissingBean
  public Clikgate clikgate(ClikgateProperties p, ObjectProvider<OnError> onError) {
    Clikgate.Builder b =
        Clikgate.builder()
            .apiKey(p.getApiKey())
            .baseUrl(p.getBaseUrl())
            .timeout(p.getTimeout())
            .maxRetries(p.getMaxRetries())
            .sendMode("sync".equalsIgnoreCase(p.getSendMode()) ? SendMode.SYNC : SendMode.BACKGROUND)
            .privateMode(privateMode(p.getPrivateMode()))
            .clickIdParam(p.getClickIdParam())
            .batchSize(p.getBatchSize())
            .flushInterval(p.getFlushInterval())
            .maxQueueSize(p.getMaxQueueSize())
            .identitySecret(p.getIdentitySecret() == null || p.getIdentitySecret().isEmpty() ? null : p.getIdentitySecret())
            .identitySecrets(p.getIdentitySecrets().isEmpty() ? null : p.getIdentitySecrets())
            .shutdownHooks(false); // the context's lifecycle closes it
    if (p.getProxy() != null && !p.getProxy().isEmpty()) {
      b.proxy(p.getProxy());
    }
    OnError handler = onError.getIfAvailable();
    if (handler != null) {
      b.onError(handler);
    }
    return b.build();
  }

  static PrivateMode privateMode(String value) {
    switch (value.toLowerCase(Locale.ROOT)) {
      case "true":
      case "on":
        return PrivateMode.ON;
      case "false":
      case "off":
        return PrivateMode.OFF;
      default:
        return PrivateMode.AUTO;
    }
  }

  /** The click-ID filter for servlet web applications. */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
  @ConditionalOnClass(FilterRegistrationBean.class)
  @ConditionalOnProperty(prefix = "clikgate.filter", name = "enabled", havingValue = "true", matchIfMissing = true)
  static class FilterConfiguration {
    @Bean
    @ConditionalOnMissingBean(name = "clikgateFilter")
    FilterRegistrationBean<ClikgateFilter> clikgateFilter(Clikgate clikgate, ClikgateProperties p) {
      ClikgateFilter filter = new ClikgateFilter(clikgate, p.getCookie().isPersist(), p.getCookie().getDays(), p.getCookie().getDomain());
      FilterRegistrationBean<ClikgateFilter> reg = new FilterRegistrationBean<>(filter);
      reg.setName("clikgateFilter");
      reg.setOrder(p.getFilter().getOrder());
      reg.addUrlPatterns("/*");
      return reg;
    }
  }

  /**
   * {@code POST /cg/keep} (change 16), only with {@code clikgate.keep-route.enabled=true}: nothing appears unasked.
   * With Spring Security, exclude the path from CSRF; see {@link ClikgateKeepController}.
   */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
  @ConditionalOnClass(WebMvcConfigurer.class)
  @ConditionalOnProperty(prefix = "clikgate.keep-route", name = "enabled", havingValue = "true")
  static class KeepRouteConfiguration {
    @Bean
    @ConditionalOnMissingBean
    ClikgateKeepController clikgateKeepController(Clikgate clikgate, ClikgateProperties p) {
      ClickIds.CookieOptions options =
          ClickIds.CookieOptions.defaults().days(p.getCookie().getDays()).domain(p.getCookie().getDomain()).secure(p.getKeepRoute().isSecure());
      return new ClikgateKeepController(clikgate.clickIds().keepRoute(options));
    }
  }

  /** {@code @ClikgateClickId String clickId} in Spring MVC handlers. */
  @Configuration(proxyBeanMethods = false)
  @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
  @ConditionalOnClass(WebMvcConfigurer.class)
  static class MvcConfiguration implements WebMvcConfigurer {
    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
      resolvers.add(new ClickIdArgumentResolver());
    }
  }

  /** Resolves {@link ClikgateClickId} parameters from the filter's request attribute. */
  static final class ClickIdArgumentResolver implements HandlerMethodArgumentResolver {
    @Override
    public boolean supportsParameter(MethodParameter parameter) {
      return parameter.hasParameterAnnotation(ClikgateClickId.class) && String.class.equals(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mav, NativeWebRequest request, WebDataBinderFactory binder) {
      return request.getAttribute(ClikgateFilter.ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
    }
  }
}
