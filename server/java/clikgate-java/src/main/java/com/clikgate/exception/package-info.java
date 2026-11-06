/** Typed exceptions (SPEC section 5). Every exception extends {@link com.clikgate.exception.ClikgateException}. *
 * <p>Nullability: parameters and results are non-null unless annotated with JSpecify {@code @Nullable} (Kotlin
 * reads it). {@code @NullMarked} isn't used because its {@code MODULE} target can't be read by a Java 8 build.
 */
package com.clikgate.exception;
