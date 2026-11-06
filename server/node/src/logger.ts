/** A console-compatible logger. `warn` and `error` are required; `info` and `debug` are optional. */
export interface Logger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  debug?(message: string, context?: Record<string, unknown>): void;
}

/** Stable warning codes (SPEC section 15). */
export type WarningCode =
  | 'inexact_number'
  | 'unknown_goal'
  | 'value_not_allowed'
  | 'value_required'
  | 'config_unavailable'
  | 'sdk_below_minimum_version'
  | 'queue_full_dropped'
  | 'unrecognised_payment_response';

/** @internal The default logger: warnings and errors to the console, prefixed. */
export const consoleLogger: Logger = {
  warn: (message, context) => console.warn(`[clikgate] ${message}`, ...(context ? [context] : [])),
  error: (message, context) => console.error(`[clikgate] ${message}`, ...(context ? [context] : [])),
};
