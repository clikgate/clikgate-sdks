package com.clikgate;

import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;

/**
 * Where the SDK logs (SPEC section 15). Warnings carry a stable code ({@code inexact_number}, {@code unknown_goal},
 * {@code value_not_allowed}, {@code value_required}, {@code config_unavailable}, {@code sdk_below_minimum_version},
 * {@code queue_full_dropped}). Messages never contain API keys, secrets, bodies, values or (in private mode) references.
 *
 * <p>The default is SLF4J when it is on the classpath (logger {@code com.clikgate}, the code in the MDC key
 * {@code clikgate_code}), else {@code java.util.logging} (logger {@code com.clikgate}).
 */
public interface ClikgateLogger {
  void warn(String code, String message);

  void error(String code, String message);

  /** The default: SLF4J if present, else java.util.logging. */
  static ClikgateLogger standard() {
    try {
      Class.forName("org.slf4j.LoggerFactory", false, ClikgateLogger.class.getClassLoader());
      return Slf4j.create();
    } catch (ClassNotFoundException | LinkageError e) {
      return jul();
    }
  }

  /** java.util.logging, logger {@code com.clikgate}. */
  static ClikgateLogger jul() {
    Logger logger = Logger.getLogger("com.clikgate");
    return new ClikgateLogger() {
      @Override
      public void warn(String code, String message) {
        log(Level.WARNING, code, message);
      }

      @Override
      public void error(String code, String message) {
        log(Level.SEVERE, code, message);
      }

      private void log(Level level, String code, String message) {
        if (logger.isLoggable(level)) {
          LogRecord r = new LogRecord(level, "[clikgate] {0} ({1})");
          r.setParameters(new Object[] {message, code});
          r.setLoggerName(logger.getName());
          logger.log(r);
        }
      }
    };
  }

  /** SLF4J binding, loaded only when SLF4J is present. */
  final class Slf4j {
    private Slf4j() {}

    static ClikgateLogger create() {
      org.slf4j.Logger logger = org.slf4j.LoggerFactory.getLogger("com.clikgate");
      return new ClikgateLogger() {
        @Override
        public void warn(String code, String message) {
          org.slf4j.MDC.put("clikgate_code", code);
          try {
            logger.warn("{} ({})", message, code);
          } finally {
            org.slf4j.MDC.remove("clikgate_code");
          }
        }

        @Override
        public void error(String code, String message) {
          org.slf4j.MDC.put("clikgate_code", code);
          try {
            logger.error("{} ({})", message, code);
          } finally {
            org.slf4j.MDC.remove("clikgate_code");
          }
        }
      };
    }
  }
}
