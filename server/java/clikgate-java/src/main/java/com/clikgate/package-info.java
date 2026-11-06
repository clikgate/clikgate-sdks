/**
 * The official Clikgate server SDK for Java and Kotlin.
 *
 * <pre>{@code
 * Clikgate clikgate = Clikgate.fromEnv();   // reads CLIKGATE_API_KEY
 * clikgate.goal("account_opened", Goal.builder().clickId(clickId).reference("APP-55231").value(new BigDecimal("2000000")).build());
 * }</pre>
 *
 * <p>Nullability: parameters and results are non-null unless annotated with JSpecify {@code @Nullable} (Kotlin
 * reads it). {@code @NullMarked} isn't used because its {@code MODULE} target can't be read by a Java 8 build.
 */
package com.clikgate;
