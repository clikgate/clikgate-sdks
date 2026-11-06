package com.clikgate;

import com.clikgate.exception.ClikgateException;

/**
 * Called for failures that can't be thrown: background sends and every {@code goal()} call.
 *
 * <pre>{@code
 * Clikgate.builder().onError((error, context) -> metrics.increment("clikgate." + error.getCode())).build();
 * }</pre>
 */
@FunctionalInterface
public interface OnError {
  void accept(ClikgateException error, ErrorContext context);
}
