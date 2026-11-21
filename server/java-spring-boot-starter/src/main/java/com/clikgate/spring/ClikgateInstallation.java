package com.clikgate.spring;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Injects the app's {@code Clikgate-Installation} header, parsed, into a Spring MVC handler parameter of type
 * {@link com.clikgate.Installation}: null when the header is missing, invalid, too long or sent more than once. It
 * never fails the request. Use it with {@code identifyUser} after your own sign-in check; the customer ID always comes
 * from your signed-in user, never from the request.
 *
 * <pre>{@code
 * @PostMapping("/login")
 * Session login(@RequestBody Credentials credentials, @ClikgateInstallation Installation installation) {
 *   User user = auth.signIn(credentials);   // your own sign-in check first
 *   if (installation != null) {
 *     clikgate.identifyUser(IdentifyUserParams.builder().installation(installation).customerId(user.getId()).build());
 *   }
 *   …
 * }
 * }</pre>
 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface ClikgateInstallation {}
